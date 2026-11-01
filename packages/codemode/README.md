# @opencode/codemode

This is our take on code mode: a lightweight, pure interpreter for a JavaScript-like language built around calling
tools. It supports familiar JavaScript syntax with a few key differences and limitations. See the
[interpreter support checklist](./interpreter-support.md) for more details.

Rather than trying to sandbox arbitrary JavaScript, CodeMode only runs the language features we implement. Programs
cannot directly access the network, filesystem, processes, or application APIs. They can interact with the outside
world only through tools provided by the host, which can also limit execution time, tool calls, output size, and data.

The idea of code mode was originally introduced by Cloudflare. See
[their post](https://blog.cloudflare.com/code-mode/) to learn more about the concept and their isolate-based approach.

## How it differs from JavaScript

- **Only supported APIs are available.** Programs can use the provided tools, supported JavaScript built-ins, and the
  globals the host adds through extensions. Timers, `process`, filesystem access, imports, and modules are unavailable.
- **Unfinished work is interrupted.** Tool calls and async functions start when called. When the program finishes,
  anything still running is interrupted. Unhandled rejections from un-awaited promises are returned as warnings.
- **REPL-style results.** Without an explicit `return`, the final top-level expression becomes the result. `undefined`
  becomes `null`.

Unsupported syntax returns an `UnsupportedSyntax` diagnostic with a source location. Current gaps are tracked in the
[interpreter support checklist](./interpreter-support.md).

## Quick Start

```ts
import { CodeMode, Namespace, Tool } from "@opencode/codemode"
import { Effect, Schema } from "effect"

const lookupOrder = Tool.make({
  description: "Look up an order by ID",
  input: Schema.Struct({ id: Schema.String }),
  output: Schema.Struct({ id: Schema.String, status: Schema.String }),
  execute: ({ id }) => Effect.succeed({ id, status: "open" }),
})

const runtime = CodeMode.make({
  tools: { orders: { lookup: lookupOrder } },
})

const result = await Effect.runPromise(
  runtime.execute(`
    const order = await tools.orders.lookup({ id: "order_42" })
    return { id: order.id, needsAttention: order.status !== "complete" }
  `),
)
```

`result` is always a [`CodeMode.Result`](#results).

## API

### `Tool.make`

`input` and `output` accept either an Effect Schema or a render-only JSON Schema document. Effect Schema input is
decoded before `execute`; Effect Schema output is decoded and safely copied before the program sees it. JSON Schemas
only shape the model-visible signature. Without `output`, the signature uses `Promise<void>`.

Descriptions and schemas are model-visible contracts. Authorization belongs in `execute`.

Nested records are the shorthand for ordinary namespaces. Use `Namespace.make` when a namespace needs a description:

```ts
const runtime = CodeMode.make({
  tools: {
    orders: Namespace.make({
      description: "Purchases, fulfillment, and shipment tracking",
      tools: { lookup: lookupOrder },
    }),
  },
})
```

Namespace descriptions are optional and participate in search matching for every descendant tool. Names still come
from record keys, so the wrapper does not repeat `orders`. Dots in keys create nested paths; other characters use
bracket notation, such as `tools.context7["resolve-library-id"](...)`.

### `CodeMode.execute` and `CodeMode.make`

`CodeMode.execute({ ...options, code })` runs once. `CodeMode.make(options)` creates a reusable runtime:

```ts
const runtime = CodeMode.make({ tools, limits: { timeoutMs: 30_000 } })

runtime.catalog() // structured tool descriptions
runtime.execute(source) // Effect<CodeMode.Result, never, ToolServices>
```

The Effect environment is inferred from the supplied tools. `hooks` surround every call the program makes into the
host: `tool.before`/`tool.after` receive `{ name, input }` with decoded input, `extension.before`/`extension.after`
receive `{ extension, name, args }`. An `after` hook also receives how the call ended (`success` with its value,
`failure` with its error, or `interrupted`). A `before` hook runs before the call reaches the host, and a failing one
denies it: the host function is never called, and the program catches the failure as a thrown error. A denied call
fails the way the call itself would: a tool call or asynchronous global rejects its promise, and a synchronous global
throws.

### `Extension.make`

Extensions are host functions a program calls directly as globals, such as `fetch`. Unlike tools they are not in the
catalog, not counted against `maxToolCalls`, and not described to the model; the host decides what they mean.

```ts
const web = Extension.make({ name: "web", globals: { fetch: async (url: string) => globalThis.fetch(url) } })
const runtime = CodeMode.make({ tools, extensions: [web] })
```

A global is synchronous unless it is an `async` function or is marked with `Extension.async`. Mark a plain function
that returns a Promise or an Effect, so a denied call rejects its promise like any other failure:

```ts
Extension.make({ name: "web", globals: { fetch: Extension.async((url: string) => globalThis.fetch(url)) } })
```

A global may return a value, a Promise, or an Effect. An Effect's requirements join the runtime's environment the same
way a tool's do, so the host can provide per-execution services such as the calling session:

```ts
const web = Extension.make({
  name: "web",
  globals: {
    fetch: Extension.async((url: string) =>
      Effect.gen(function* () {
        const session = yield* Session
        yield* session.authorize(url)
        return yield* Effect.promise(() => globalThis.fetch(url))
      }),
    ),
  },
})
const result = yield* CodeMode.make({ extensions: [web] }).execute(code).pipe(Effect.provideService(Session, session))
```

Every value crossing in either direction is converted, never shared: arguments come in as copies, results go out as
copies, and a function inside a result is callable the same way. A global that shadows a built-in or another
extension throws at `CodeMode.make`.

### OpenAPI tools

`OpenAPI.fromSpec` converts an OpenAPI 3.x document into one tool per supported operation. Dotted `operationId` values
create namespaces:

```ts
const api = OpenAPI.fromSpec({ spec, auth: { resolve } })
const runtime = CodeMode.make({ tools: { opencode: api.tools } })
```

The synchronous result is `{ tools, skipped }`. Operations with unsupported parameter encodings, request bodies
without JSON content, WebSocket or SSE semantics, or binary responses are reported in `skipped`.

Authentication is resolved by the host and never shown to the model. Generated tools require `HttpClient.HttpClient`.
Request signatures omit `readOnly` properties; response signatures omit `writeOnly` properties. These JSON Schemas
shape model-visible signatures but do not filter runtime values: nested JSON body properties and decoded server
responses pass through unchanged. See `src/openapi/types.ts` for option details.

## Results

Every execution returns:

```ts
type Result =
  | {
      readonly ok: true
      readonly value: CodeMode.DataValue
      readonly warnings?: ReadonlyArray<CodeMode.Diagnostic>
      readonly logs?: ReadonlyArray<string>
      readonly truncated?: boolean
      readonly toolCalls: ReadonlyArray<CodeMode.ToolCall>
    }
  | {
      readonly ok: false
      readonly error: CodeMode.Diagnostic
      readonly logs?: ReadonlyArray<string>
      readonly truncated?: boolean
      readonly toolCalls: ReadonlyArray<CodeMode.ToolCall>
    }
```

`value` is JSON-safe. `warnings` are non-fatal diagnostics, `logs` contain program console output, and `truncated`
indicates that retained output was cut by `maxOutputBytes`. `toolCalls` retains admitted calls in order, including after
failure.

Diagnostic kinds:

| Kind                    | Meaning                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `ParseError`            | Source is empty or cannot be parsed.                                                           |
| `UnsupportedSyntax`     | Parsed JavaScript is outside the supported subset.                                             |
| `UnknownTool`           | The program referenced an unavailable tool.                                                    |
| `InvalidToolInput`      | Tool input failed schema decoding or safe-data copying.                                        |
| `InvalidToolOutput`     | Tool output failed schema decoding or safe-data copying.                                       |
| `InvalidDataValue`      | Program data violated the plain-data contract.                                                 |
| `ToolCallLimitExceeded` | The program exceeded `maxToolCalls`.                                                           |
| `TimeoutExceeded`       | Execution timed out; as a warning, background work was interrupted after the program returned. |
| `ToolFailure`           | A tool refused or failed.                                                                      |
| `ExecutionFailure`      | The program threw or another execution error occurred.                                         |
| `Truncated`             | Warning only: additional warnings were omitted by `maxOutputBytes`.                            |
| `StateNotSaved`         | Warning only, in REPL mode: a value or the whole cell's state was not saved for later cells.   |

Host failures and defects report their messages and underlying causes. Invalid outputs include the validation or
copying error. Interruption propagates without becoming an error diagnostic.

## Discovery

`runtime.catalog()` returns structured descriptors — exact path, description, and generated TypeScript signature — for
every visible tool. Hosts render their own model-facing instructions from these descriptors; `CodeMode.searchSignature`
and `CodeMode.toolExpression(path)` supply the exact callable forms.

The synchronous `search(...)` built-in is always available. It supports exact-path lookup, namespace-scoped search,
empty-query browsing, and pagination, and returns callable paths with full signatures. Its result can be used directly,
awaited, or chained with `then`, `catch`, and `finally`, so programs work whichever way they treat it. Search counts toward
`maxToolCalls`. Search also matches descriptions from enclosing `Namespace` values.

## Execution Limits

| Limit            | Default   | Controls                        |
| ---------------- | --------- | ------------------------------- |
| `timeoutMs`      | unlimited | Total execution time.           |
| `maxToolCalls`   | unlimited | Admitted tool calls.            |
| `maxOutputBytes` | unlimited | Retained result value and logs. |

Execution limits have no default values.

Invalid limit configuration throws `RangeError`. Warnings receive a separate budget equal to `maxOutputBytes`.
Truncation does not fail execution; an oversized value becomes a string with an in-band marker. Timeouts interrupt
tool calls and busy loops, while a result returned before cleanup times out remains successful with a
`TimeoutExceeded` warning. Tool-call concurrency is unrestricted. Boundary data is limited to 32 nested levels.

## REPL mode

REPL mode is off by default. When a host turns it on, each `execute` call is a cell, and top-level declarations
(`const`, `let`, `var`, `function`) carry over to later cells with their values, mutations, and shared references:

```ts
const runtime = CodeMode.make({ tools, repl: true })

await Effect.runPromise(runtime.execute(`const orders = await tools.orders.list({}); let seen = 0`))
await Effect.runPromise(runtime.execute(`seen += orders.length; seen`)) // { ok: true, value: <orders.length> }
```

Within one cell, JavaScript's rules apply. Across cells, a declaration replaces the earlier binding of the same name,
as in Node's REPL, so `const` and `let` can be declared again; a `var` without an initializer keeps the earlier value.
Cells of one runtime run one at a time. Limits apply to each cell, including restoring and saving its state.

State is committed after each successful cell. A cell that fails commits nothing, so the next cell sees the state
from before it: a cell that throws halfway leaves no half-applied changes behind.

### Stores

`repl: true` keeps state in memory for the runtime's lifetime. To keep it across runtimes or processes, pass a store:

```ts
const runtime = CodeMode.make({ tools, repl: { store, maxStateBytes: 16 * 1024 * 1024 } })
```

A new runtime given the same store continues from the last commit; cells are never replayed. `Repl.memory()` is the
built-in store; hosts implement `Repl.Store` over their own storage:

```ts
type Store = {
  // The latest commit, or undefined before the first.
  readonly head: () => Effect.Effect<Repl.Commit | undefined, unknown>
  // These records as visible at `commit`: the newest version written at it or an ancestor. Missing ids are omitted.
  readonly read: (commit: string, ids: ReadonlyArray<number>) => Effect.Effect<ReadonlyArray<Repl.Record>, unknown>
  // Atomically store the commit and its records and make it the head, only if the head is still `commit.parent`.
  readonly write: (commit: Repl.Commit, records: ReadonlyArray<Repl.Record>) => Effect.Effect<boolean, unknown>
}
```

The state is one record per object, scope, and cell source, keyed by an integer id that never changes for that
object, so a commit carries only new and changed records (`{ id, data, refs }`, where `data` is opaque JSON text and
`refs` lists the ids it points to). Each commit names its parent, so a host can map commits to conversation messages
and fork or revert by moving the head. Restoring reads breadth-first from `commit.root` along `refs`. Nothing is
deleted: records no kept commit reaches can be collected by the host by walking `refs`.

A failed `read` fails the cell. A failed or conflicting `write`, or state over `maxStateBytes` (default 16 MiB,
counted over everything reachable), keeps the cell's result but adds a `StateNotSaved` warning.

### What is saved

Program data, functions, and closures are saved; built-ins and extension globals are saved by name, and tool
references by path, so each resolves against the runtime that restores it. A function is saved as its cell's source
and position plus the scopes it captured; a function defined in an earlier cell keeps reporting error locations in
that cell's source.

Values that cannot be saved are never dropped silently. A pending or rejected promise, a generator, an iterator, a
`WeakMap` or `WeakSet`, a bound function, or a host function returned by an extension is restored as a placeholder:
reading a top-level binding that held one, or calling, reading, or writing through a nested one, throws an error that
names where it was and the cell that defined it. The cell that held it gets a `StateNotSaved` warning. Changes to
built-in objects such as `Array.prototype` are not kept either and are reported the same way.

### Inventory

`Repl.inventory(store)` returns the top-level bindings at the head, so a host can tell the model what exists after a
compaction or restart without running code:

```ts
type Binding = {
  readonly name: string
  readonly declaration: "const" | "let" | "var" | "function"
  readonly cell: number // the committed cell that last declared it, counting from 1
  readonly kind: string // "number", "string", "object", "array", "function", "tool", "lost", "Map", ...
  readonly preview: string // at most 100 characters, such as `{ id: 1, name: "Ada" }` or `function greet(who)`
  readonly bytes: number // stored bytes first reached through this binding
  readonly lost?: string // the placeholder's message, when the value could not be saved
}
```

The same list is on every `Repl.Commit` as `bindings`.
