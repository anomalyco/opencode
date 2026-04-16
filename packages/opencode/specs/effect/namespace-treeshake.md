# Namespace → self-reexport migration

Migrate every `export namespace Foo { ... }` to flat top-level exports plus a
single self-reexport line at the bottom of the same file:

```ts
export * as Foo from "./foo"
```

No barrel `index.ts` files. No cross-directory indirection. Consumers keep the
exact same `import { Foo } from "../foo/foo"` ergonomics.

## Why this pattern

We tested three options against Bun, esbuild, Rollup (what Vite uses under the
hood), Bun's runtime, and Node's native TypeScript runner.

```
                                       heavy.ts loaded?
                                       A. namespace   B. barrel   C. self-reexport
Bun bundler                            YES            YES         no
esbuild                                YES            YES         no
Rollup (Vite)                          YES            YES         no
Bun runtime                            YES            YES         no
Node --experimental-strip-types        SYNTAX ERROR   YES         no
```

- **`export namespace`** compiles to an IIFE. Bundlers see one opaque function
  call and can't analyze what's used. Node's native TS runner rejects the
  syntax outright: `SyntaxError: TypeScript namespace declaration is not
supported in strip-only mode`.
- **Barrel `index.ts`** files (`export * as Foo from "./foo"` in a separate
  file) force every re-exported sibling to evaluate when you import one name.
  Siblings with side effects (top-level imports of SDKs, etc.) always load.
- **Self-reexport** keeps the file as plain ESM. Bundlers see static named
  exports. The module is only pulled in when something actually imports from
  it. There is no barrel hop, so no sibling contamination and no circular
  import hazard.

Bundle overhead for the self-reexport wrapper is roughly 240 bytes per module
(`Object.defineProperty` namespace proxy). At ~100 modules that's ~24KB —
negligible for a CLI binary.

## The pattern

### Before

```ts
// src/permission/arity.ts
export namespace BashArity {
  export function prefix(tokens: string[]) { ... }
}
```

### After

```ts
// src/permission/arity.ts
export function prefix(tokens: string[]) { ... }

export * as BashArity from "./arity"
```

Consumers don't change at all:

```ts
import { BashArity } from "@/permission/arity"
BashArity.prefix(...) // still works
```

Editors still auto-import `BashArity` like any named export, because the file
does have a named `BashArity` export at the module top level.

### Odd but harmless

`BashArity.BashArity.BashArity.prefix(...)` compiles and runs because the
namespace contains a re-export of itself. Nobody would write that. Not a
problem.

## Why this is different from what we tried first

An earlier pass used sibling barrel files (`index.ts` with `export * as ...`).
That turned out to be wrong for our constraints:

1. The barrel file always loads all its sibling modules when you import
   through it, even if you only need one. For our CLI this is exactly the
   cost we're trying to avoid.
2. Barrel + sibling imports made it very easy to accidentally create circular
   imports that only surface as `ReferenceError` at runtime, not at
   typecheck.

The self-reexport has none of those issues. There is no indirection. The
file and the namespace are the same unit.

## Why this matters for startup

The worst import chain in the codebase looks like:

```
src/index.ts
  └── FormatError from src/cli/error.ts
        ├── { Provider } from provider/provider.ts     (~1700 lines)
        │     ├── 20+ @ai-sdk/* packages
        │     ├── @aws-sdk/credential-providers
        │     ├── google-auth-library
        │     └── more
        ├── { Config } from config/config.ts           (~1600 lines)
        └── { MCP } from mcp/mcp.ts                    (~900 lines)
```

All of that currently gets pulled in just to do `.isInstance()` on a handful
of error classes. The namespace IIFE shape is the main reason bundlers cannot
strip the unused parts. Self-reexport + flat ESM fixes it.

## Automation

From `packages/opencode`:

```bash
bun script/unwrap-namespace.ts <file> [--dry-run]
```

The script:

1. Uses ast-grep to locate the `export namespace Foo { ... }` block accurately.
2. Removes the `export namespace Foo {` line and the matching closing `}`.
3. Dedents the body by one indent level (2 spaces).
4. Rewrites `Foo.Bar` self-references inside the file to just `Bar`.
5. Appends `export * as Foo from "./<basename>"` at the bottom of the file.
6. Never creates a barrel `index.ts`.

### Typical flow for one file

```bash
# 1. Preview
bun script/unwrap-namespace.ts src/permission/arity.ts --dry-run

# 2. Apply
bun script/unwrap-namespace.ts src/permission/arity.ts

# 3. Verify
cd packages/opencode
bunx --bun tsgo --noEmit
bun run --conditions=browser ./src/index.ts generate
bun run test <affected test files>
```

### Consumer imports usually don't need to change

Most consumers already import straight from the file, e.g.:

```ts
import { BashArity } from "@/permission/arity"
import { Config } from "@/config/config"
```

Because the file itself now does `export * as Foo from "./foo"`, those imports
keep working with zero edits.

The only edits needed are when a consumer was importing through a previous
barrel (`"@/config"` or `"../config"` resolving to `config/index.ts`). In
that case, repoint it at the file:

```ts
// before
import { Config } from "@/config"

// after
import { Config } from "@/config/config"
```

### Dynamic imports in tests

If a test did `const { Foo } = await import("../../src/x/y")`, the destructure
still works because of the self-reexport. No change required.

## Verification checklist (per PR)

Run all of these locally before pushing:

```bash
cd packages/opencode
bunx --bun tsgo --noEmit
bun run --conditions=browser ./src/index.ts generate
bun run test <affected test files>
```

Also do a quick grep in `src/`, `test/`, and `script/` to make sure no
consumer is still importing the namespace from an old barrel path that no
longer exports it.

The SDK build step (`bun run --conditions=browser ./src/index.ts generate`)
evaluates every module eagerly and is the most reliable way to catch circular
import regressions at runtime — the typechecker does not catch these.

## Rules for new code

- No new `export namespace`.
- Every module file that wants a namespace gets a self-reexport at the
  bottom:
  `export * as Foo from "./foo"`
- Consumers import from the file itself:
  `import { Foo } from "../path/to/foo"`
- No new barrel `index.ts` files for internal code.
- If a file needs a sibling, import the sibling file directly:
  `import * as Sibling from "./sibling"`, not `from "."`.

## Scope

There are still dozens of `export namespace` files left across the codebase.
Each one is its own small PR. Do them one at a time, verified locally, rather
than batching by directory.
