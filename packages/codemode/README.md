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
  globals the host adds through extensions. Timers, `process`, filesystem access, packages, and `export` are
  unavailable.
- **Unfinished work is interrupted.** Tool calls and async functions start when called. When the program finishes,
  anything still running is interrupted. Unhandled rejections from un-awaited promises are returned as warnings.
- **REPL-style results.** Without an explicit `return`, the final top-level expression becomes the result. `undefined`
  becomes `null`.

Unsupported syntax returns an `UnsupportedSyntax` diagnostic with a source location. Current gaps are tracked in the
[interpreter support checklist](./interpreter-support.md).

## Layout

The package is two layers, as folders under `src/`:

- `src/language/` is the language: the compiler, VM, runtime, standard library, prelude, scheduler, snapshots, and the
  Effect driver. It knows nothing about tools. A host gives programs its functions with `Host` and runs them with
  `Runtime.make` (see [The language layer](#the-language-layer)).
- `src/codemode/` is Code Mode, built on the language: tools and their schemas, the catalog and namespaces, `search`,
  `scanTools`, OpenAPI, hooks, `maxToolCalls`, `CodeMode.make`, and `Extension.make`.

Nothing in `src/language/` imports from `src/codemode/`; a test checks it. The package's public API is Code Mode's.

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

Set `freeform: true` on a tool whose input is one required string field to let programs pass that string directly. For
`{ patchText: string }`, the catalog shows `tools.patch(patchText: string)`, and `tools.patch("*** Begin Patch...")`
delivers `{ patchText: "*** Begin Patch..." }` to validation, hooks and the executor. The object form still works.

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
host: `tool.before`/`tool.after` receive `{ name, input, key }` with decoded input and the call's `<runId>:<callId>`
idempotency key, and `extension.before`/`extension.after` receive `{ extension, name, args }`. An `after` hook also
receives how the call ended (`success` with its value, `failure` with its error, or `interrupted`). A `before` hook
runs before the call reaches the host, and a failing one denies it: the host function is never called, and the program
catches the failure as a thrown error. A denied call fails the way the call itself would: a tool call or asynchronous
global rejects its promise, and a synchronous global throws.

Tool arguments cross into the host the way extension arguments do, as copies (plain data, `Date`, `Map`, `Set`, `URL`,
`Headers`, errors), and Code Mode then turns them into JSON next to the tool's schema: a `Date` is its ISO string, a
`Set` its items, a `URLSearchParams` its query string, an `Error` `{ name, message, ...own fields }`, and `Map` and
`RegExp` values `{}`. A `Uint8Array` asks to be encoded as text first. A program's own `toJSON` is not called, and a
promise or function inside an argument fails the call: await it, or pass its data.

### Suspending and resuming a run

`CodeMode.make` returns a `CodeMode.Runtime`, which can also run a program step by step:
`runtime.program(code, bindings?, { runId }?)` makes a `CodeMode.Program`, and nothing runs until `program.run()`. Every
host call gets a stable key `<runId>:<callId>` (using a generated UUID when `runId` is omitted), saved in the snapshot
and passed to tools as `execute(input, { key })` and to hooks as `call.key`. `run()` runs the program in the current
fiber until it ends or is suspended, and gives a `CodeMode.Outcome`: a `Result`, or:

```ts
type Suspended = {
  ok: "suspended"
  state: CodeMode.Snapshot // JSON; CodeMode.toBytes / CodeMode.fromBytes convert it
}

const runtime = CodeMode.make({ tools })

// inline
const outcome = yield* runtime.program(code).run()

// in the background, suspended from another fiber
const program = runtime.program(code, undefined, { runId: "run-1" })
const fiber = yield* Effect.forkChild(program.run())
const suspended = yield* program.suspend() // the same Suspended that run() returns
const outcome = yield* Fiber.join(fiber)

// later, in this process or another one built from the same version
yield* runtime.resume(CodeMode.toBytes(suspended.state)).run()
```

A program runs once: running it again is a defect, so make another with `runtime.program` or
`runtime.resume`. `run()` owns the run's host calls: interrupting it interrupts the program and every call in progress
(and cancels any started durable tool work).

#### Idempotent and durable tools, and safe suspension

A tool's `execute` is either a plain function or wrapped with `Tool.idempotent` or `Tool.durable`:

```ts
// plain (default): a suspend is refused while it runs
Tool.make({
  description: "...",
  input: ...,
  output: ...,
  execute: (input, { key }) => compute(input),
})

// idempotent: safe to run again; interrupted on suspend, rerun on resume with the same key
Tool.make({
  description: "...",
  input: ...,
  output: ...,
  execute: Tool.idempotent((input, { key }) => Db.get(input.name)),
})

// durable: keeps running across a suspend, reconnected through its JSON data on resume
Tool.make({
  description: "...",
  input: ...,
  output: ...,
  execute: Tool.durable({
    start: (input, { key }) => Jobs.submit(input, key).pipe(Effect.map((id) => ({ id }))),
    wait: ({ id }, { key }) => Jobs.wait(id),
    cancel: ({ id }) => Jobs.kill(id),
  }),
})
```

- **Plain (`execute: (input, { key }) => ...`):** not durable. Suspend is refused while the call is running.
- **`Tool.idempotent(execute)`:** idempotent/read-only work safe to run again. If a suspend lands while the call is
  running, the VM detaches and interrupts it without firing `tool.after`, saves the call in the snapshot as queued, and
  re-runs it on resume with the same `key` without double-counting it against `maxToolCalls`.
- **`Tool.durable({ start, wait, cancel })`:** work that outlives a suspended run:
  - `start(input, { key }) => Effect<Data /* Json */>` begins the work and returns JSON `data` (inferred into `wait`
    and `cancel`);
  - `wait(data, { key }) => Effect<Output>` connects to the running work and waits for its result;
  - `cancel(data) => Effect<void>` stops the work when the run is interrupted for real or ends, never when it is
    suspended.

  While `start` is running, the call blocks suspend. Once `start` returns its JSON data, the call is in the `started`
  state with its data saved in the snapshot, and suspend is allowed. `wait` is not tied to the program's JavaScript
  `await`: the VM calls `wait(data)` right after `start` returns, and calls `wait(data)` again for every `started` call
  right when `resume` starts, whatever the program does with the call's promise (whether it `await`s it immediately,
  passes it to `Promise.all`, chains `.then`, or keeps the unawaited promise in a variable and awaits it later).

`program.suspend(options?)` saves the run's state and stops it at once, and `run()` returns the same `Suspended`.
Suspend is allowed only when every in-flight call is queued, `Tool.idempotent`, or `Tool.durable` in `started`. When
any other host call is in progress — a plain tool, a durable tool still in `start`, `search`, or an async or
synchronous extension call — `suspend` fails with a `CodeMode.SuspendError` naming each blocking call in `running` by
its `key` and `path` (`tools.x.y`, `search`, `fetch`), and the run goes on untouched. Tool calls queued but not started
don't block: they start on resume. Outcomes already waiting in the inbox are part of the state. A suspend after the run
ended gives its result; one issued before `run()` has started waits for it to start (and for ever if it never runs).

The suspend is immediate: the program shares the thread with the caller, so it is at a step boundary. Its checks, saving
the state, and checking it against `options.maxBytes` all happen before anything about the run changes, so a state that
can't be saved or is too large fails the suspend the same way.

A resumed run keeps the limits it was saved with: `timeoutMs` counts active time across every resume, and `maxToolCalls`
counts every admitted call of the run (Code Mode keeps them in the run's `metadata`, saved with the state). A state
resumes only on the same build of this package and with the same host globals (the same extension globals, with the
same `snapshot` hooks). The state is checked when the resumed program runs: its `run()` fails with a
`CodeMode.SnapshotError` when it can't be resumed here or is malformed. Built-ins are saved by name and only their
changes are copied.

Set `CODEMODE_ROUNDTRIP=1` (`bun run test:roundtrip`) to run the tests with every run saved to bytes and
restored into a brand-new runtime at every host call and every few steps.

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

A global may return a value, a Promise, or an Effect. A synchronous global's Effect runs to completion before the call
returns, so the host can offer blocking calls such as `fs.readFileSync`. An Effect's requirements join the runtime's
environment the same way a tool's do, so the host can provide per-execution services such as the calling session:

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
copies, and a function inside a result is callable the same way. When the program passes such a function back to an
extension, it arrives as the host function itself, so `copy(dest, file(src))` can tell what it was given. Globals and
the program's own functions never cross back: they are left out, as in tool arguments. A global that shadows a
built-in or another extension throws at `CodeMode.make`.

Mark a global with `Extension.constructible` to let programs call it with `new`, as they would a class. `new` calls
it the same way a plain call does, and the program gets what it returns:

```ts
Extension.make({ name: "glob", globals: { Glob: Extension.constructible((pattern: string) => makeGlob(pattern)) } })
```

Functions inside a result have no data form, so a suspended run loses them by default: after a resume, calling one
throws a `TypeError`. An extension can preserve them across suspend and resume with `snapshot` hooks. `encode` receives
a value one of the extension's functions returned, as the host function returned it, and returns plain data (JSON
values and `Uint8Array`s); on resume, `decode` receives that data once per value and returns a host value of the same
shape, whose functions the restored program copies call from then on:

```ts
const saved = Symbol("saved")
const makeResponse = (data: { url: string; body: Uint8Array }) => ({
  [saved]: data,
  url: data.url,
  text: async () => new TextDecoder().decode(data.body),
  bytes: async () => data.body,
})
const web = Extension.make({
  name: "web",
  globals: {
    fetch: Extension.async(async (url: string) =>
      makeResponse({ url, body: await (await globalThis.fetch(url)).bytes() }),
    ),
  },
  snapshot: {
    encode: (value) => (value as { [saved]: { url: string; body: Uint8Array } })[saved],
    decode: (data) => makeResponse(data as { url: string; body: Uint8Array }),
  },
})
```

A suspend fails (and the run continues) when `encode` throws or returns non-plain data. A snapshot saved with an
extension's hooks resumes only in a runtime whose globals of the same names also have `snapshot` hooks.

A global can also be an object of functions, such as `fs`. Every function reachable from it is an entry point like a
global, so calls fire the `extension` hooks with their path as the name (`fs.readFile`, `fs.promises.readFile`).

Programs load globals the way Node code loads modules. `import` and `require` take a global by its Node module name,
with or without `node:`; `fs/promises`, `url`, `util`, and `buffer` resolve to the globals that provide them. There are
no packages, so anything else throws.

```js
import fs, { readFile } from "node:fs" // the `fs` global, if the host provides one
import { URL } from "url"
const crypto = require("crypto")
const { default: same } = await import("fs")
```

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
responses pass through unchanged. See `src/codemode/openapi/types.ts` for option details.

## The language layer

Code Mode is built on the language layer in `src/language/`, which runs programs over any host globals. It is not part
of the package's public API yet.

```ts
import { Host, Runtime } from "./src/language/index.js"

const runtime = Runtime.make({
  // Called when a run starts, and again when it resumes, so globals can keep the run's own state.
  globals: (run) => ({
    hash: Host.fn(([text]) => sha256(text as string)), // "sync" (the default): the program waits for it
    sleep: Host.fn(([ms]) => Effect.sleep(ms as number), { type: "async" }), // the program gets a promise
    find: Host.fn(([query]) => searchIndex(query), { type: "sync-thenable" }), // the object now, also awaitable
    lookup: Host.fn(([id], { key }) => Db.get(id, key), { type: "async", idempotent: true }), // rerun on resume
    review: Host.durableFn({ start, wait, cancel }), // keeps running across a suspend
    api: Host.namespace({
      keys: (path) => childrenOf(path), // Object.keys and for...in
      resolve: (path) => fnAt(path) ?? Host.missing(`No api.${path.join(".")}`, suggestionsFor(path)),
    }),
    fs: { readFile: Host.fn(([file]) => read(file), { type: "async" }) }, // plain objects of functions work too
  }),
  limits: { timeoutMs: 30_000, maxOutputBytes: 1_000_000 },
})

const program = runtime.program(code, { bindings: { repo: "…" }, runId })
yield* program.run() // Result | Suspended
yield* program.suspend({ maxBytes })
yield* runtime.resume(bytes).run()
```

- **`Host.fn(f, { type, idempotent })`.** `f` gets the program's arguments, as they crossed, and the call, `{ key }`
  (`<runId>:<callId>`). `sync` (the default) blocks the program: an Effect runs until it ends, and a returned Promise
  is a promise. `async` hands the program a promise. `sync-thenable` returns the result at once, with hidden
  `then`/`catch`/`finally`. `idempotent: true`, only with `async`, lets a suspend interrupt a call in progress, which
  runs again on resume under the same key; any other call in progress refuses a suspend. `constructible: true` lets
  the program call it with `new`. `takesFunctions: true` lets the program pass back a function that was inside a
  result, which arrives as the host function itself, and a call holding one refuses a suspend until it completes;
  without it, such a function is treated like any other function in an argument: refused, or left out when the
  runtime's `translate.functions` is `"drop"`.
- **`Host.durableFn({ start, wait, cancel })`.** `start` gives JSON data, saved with the run; `wait(data)` runs right
  after, and again after a resume; `cancel(data)` only when the run is interrupted or ends with the work still running.
- **`Host.namespace({ keys, resolve })`.** A lazy object of functions addressed by path, for catalogs too large to
  build as objects. Any path can be read; calling one asks `resolve` for its function, or a failure it throws.
- **`Host.fail(kind, message, suggestions?)`.** A failure with its own diagnostic kind, to throw or fail with.
- **`run.metadata`.** The host's own JSON state for the run: saved with a suspended run, given back on resume, and in
  the run's result. Code Mode keeps `toolCalls` and `maxToolCalls` there.

Every host function gets the same structured translation: arguments and results cross as copies (plain data, `Date`,
`Map`, `Set`, `Uint8Array`, `URL`, `Headers`, errors), and a function inside a result is callable.

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

Host failures and defects report their messages and underlying causes. Invalid outputs include the validation or
copying error. Interruption propagates without becoming an error diagnostic.

## Discovery

`runtime.catalog()` returns structured descriptors — exact path, description, and generated TypeScript signature — for
every visible tool. Hosts render their own model-facing instructions from these descriptors; `CodeMode.searchSignature`
and `CodeMode.toolExpression(path)` supply the exact callable forms.

The synchronous `search(...)` built-in is always available. It supports exact-path lookup, namespace-scoped search,
empty-query browsing, and pagination, and returns callable paths with full signatures. Its result can be used directly,
awaited, or chained with `then`, `catch`, and `finally`, so programs work whichever way they treat it. Search counts toward
`maxToolCalls`. Search also matches descriptions from enclosing `Namespace` values. A plain string is the query:
`search("issues")` is `search({ query: "issues" })`.

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
