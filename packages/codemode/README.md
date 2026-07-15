# @opencode-ai/codemode

This is our take on code mode. Programs are written in a lightweight, JavaScript-like DSL and run in the package's
own interpreter. They never execute as actual JavaScript, so there is no runtime to escape into. The interpreter
itself can reach nothing; every effect a program has goes through a tool you explicitly supplied. The tradeoff is a
bounded language rather than full JavaScript: the [interpreter support checklist](./interpreter-support.md) documents
exactly what is supported.

[Cloudflare's post](https://blog.cloudflare.com/code-mode/) introduced the idea. Their implementation executes
generated code in isolate sandboxes. We took a lighter route: a pure interpreter that runs wherever your application
runs, no sandbox required.

## How it differs from JavaScript

The deliberate differences:

- **No ambient authority.** No `fetch`, `process`, filesystem, timers, or host globals - only the allowlisted standard
  library and supplied `tools`.
- **No dynamic code.** No `eval`, `Function`, or module loading.
- **Plain-data boundaries.** Tool arguments and program results are JSON-like data. Dates become ISO strings, RegExp,
  Map, and Set serialize as `{}`, and promises, functions, and runtime references cannot cross the boundary.
- **Eager, supervised promises.** Tool calls and async functions start immediately when called. Whatever is still
  running when the program returns is interrupted - race losers and fire-and-forget calls alike - so a program must
  await every call whose completion matters. Rejections that settle un-awaited become `warnings` on the result instead
  of crashing the run.
- **REPL-style results.** An omitted `return` yields the final top-level expression; `undefined` normalizes to `null`.

Beyond these, the language is a growing subset rather than a divergent one: unsupported syntax returns an
`UnsupportedSyntax` diagnostic with a source location, and current gaps (for example thenable assimilation, classes,
generators, and full sparse-array parity) are tracked as unchecked items in the
[interpreter support checklist](./interpreter-support.md).

## Quick Start

The package is workspace-private (`"@opencode-ai/codemode": "workspace:*"`). Hosts interact with it through `effect`
and should depend on `effect` themselves. Define tools with Effect Schema, then expose them to programs through
`tools`:

```ts
import { CodeMode, Tool } from "@opencode-ai/codemode"
import { Effect, Schema } from "effect"

const lookupOrder = Tool.make({
  description: "Look up an order by ID",
  input: Schema.Struct({ id: Schema.String }),
  output: Schema.Struct({ id: Schema.String, status: Schema.String }),
  run: ({ id }) => Effect.succeed({ id, status: "open" }),
})

const runtime = CodeMode.make({
  tools: {
    orders: {
      lookup: lookupOrder,
    },
  },
})

const result =
  yield *
  runtime.execute(`
  const order = await tools.orders.lookup({ id: "order_42" })
  return { id: order.id, needsAttention: order.status !== "complete" }
`)
```

`result` is always a `CodeMode.Result`. Program, validation, limit, and tool failures are returned as diagnostics
rather than failing the Effect; host interruption remains interruption.

## API

### `Tool.make`

`input` and `output` each accept a validating Effect Schema or a render-only JSON Schema document. Effect Schema input
is decoded before `run` is invoked; an Effect Schema `output` is decoded and copied before the program sees it. JSON
Schemas only shape the model-visible signature. Without `output` the signature advertises `Promise<unknown>`.
Descriptions and schemas are model-visible contract; keep authorization in `run`.

Dots in tool names are namespace separators: `{ "issues.list": tool }` exposes `tools.issues.list(...)`, exactly like
`{ issues: { list: tool } }`. Other non-identifier characters render with bracket notation, e.g.
`tools.context7["resolve-library-id"](...)`.

### `CodeMode.execute` and `CodeMode.make`

`CodeMode.execute({ ...options, code })` runs once and is equivalent to `CodeMode.make(options).execute(code)`. A
runtime from `make` reuses the tool set and policy:

```ts
const runtime = CodeMode.make({ tools, limits: { timeoutMs: 30_000 } })

runtime.catalog() // structured tool descriptions
runtime.instructions() // model-facing syntax and tool guide
runtime.execute(source) // CodeMode.Result
```

The Effect environment is inferred from the supplied tools; service requirements are not erased. Optional
`onToolCallStart` / `onToolCallEnd` hooks observe admitted calls with decoded input, outcome, and duration; both are
Effect-returning and must not fail.

### OpenAPI tools

`OpenAPI.fromSpec` turns an OpenAPI 3.x document into namespaced tools - one tool per operation, using dotted
`operationId` segments as namespaces:

```ts
const api = OpenAPI.fromSpec({ spec, auth: { resolve } })
const runtime = CodeMode.make({ tools: { opencode: api.tools } })
```

It is synchronous and returns `{ tools, skipped }`: operations with unsupported encodings, non-JSON bodies, binary
responses, or streaming land in `skipped` instead of producing broken tools. Auth is resolved host-side and never
model-visible; generated tools require `HttpClient.HttpClient` in the environment. See the option docstrings in
`src/openapi/types.ts` for full semantics.

## Outputs

Every execution returns a `CodeMode.Result`:

```ts
type Result = Success | Failure

interface Success {
  readonly ok: true
  readonly value: CodeMode.DataValue
  readonly warnings?: ReadonlyArray<CodeMode.Diagnostic>
  readonly logs?: ReadonlyArray<string>
  readonly truncated?: boolean
  readonly toolCalls: ReadonlyArray<CodeMode.ToolCall>
}

interface Failure {
  readonly ok: false
  readonly error: CodeMode.Diagnostic
  readonly logs?: ReadonlyArray<string>
  readonly truncated?: boolean
  readonly toolCalls: ReadonlyArray<CodeMode.ToolCall>
}
```

`value` is JSON-safe data. `warnings` are non-fatal diagnostics alongside a valid value (un-awaited rejections,
timeout cleanup after the return). `logs` holds program console output, `truncated` marks any output-budget cut, and
`toolCalls` lists admitted calls in order - retained on failure for auditing.

Failure `error` and success `warnings` share one diagnostic vocabulary:

| Kind                    | Meaning                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `ParseError`            | Source is empty or cannot be parsed.                                                                      |
| `UnsupportedSyntax`     | Parsed JavaScript is outside the supported subset.                                                        |
| `UnknownTool`           | A program referenced a tool the host did not provide.                                                     |
| `InvalidToolInput`      | Tool input failed schema decoding or safe-data copying.                                                   |
| `InvalidToolOutput`     | Tool output failed schema decoding or safe-data copying.                                                  |
| `InvalidDataValue`      | Program data violated the plain-data contract (depth, circularity, blocked properties, non-data values).  |
| `ToolCallLimitExceeded` | Calls exceeded `maxToolCalls`.                                                                            |
| `TimeoutExceeded`       | Execution exceeded `timeoutMs`; as a warning, background work was interrupted after the program returned. |
| `ToolFailure`           | A tool refused or failed.                                                                                 |
| `ExecutionFailure`      | The program threw or another execution error occurred.                                                    |
| `Truncated`             | Warning-only marker: additional warnings were omitted by `maxOutputBytes`.                                |

Unknown host failures, defects, and invalid outputs are sanitized. `toolError("safe message")` is the explicit channel
for a model-visible refusal; its optional cause never crosses the boundary.

## Discovery

The generated instructions inline a budgeted catalog (default 2,000 estimated tokens, override with
`discovery: { catalogBudget }`): every namespace is always listed with its tool count, signatures are selected
round-robin so every namespace gets representation, and the instructions state whether the list is complete or
partial. Programs also get a global `search(...)` built-in - always available, advertised when the list is partial:
synchronous, deterministic field-weighted substring matching that returns directly callable paths with full
signatures, supports namespace scoping and pagination, and treats an empty query as browsing and an exact path as
lookup. Search counts as an admitted tool call.

## Execution Limits

| Limit            |              Default | Bounds                                               |
| ---------------- | -------------------: | ---------------------------------------------------- |
| `timeoutMs`      |    none - no timeout | Wall-clock execution time.                           |
| `maxToolCalls`   |     none - unlimited | Tool calls admitted during the execution.            |
| `maxOutputBytes` | none - no truncation | Retained result value and logs; warnings separately. |

No limit has a default, on purpose: execution budgets are host policy. A host without its own truncation or
interruption should set `maxOutputBytes` and `timeoutMs`. Limits are safe integers; invalid configuration throws a
`RangeError` at construction. Exceeding `maxOutputBytes` never fails the execution - oversized output is truncated
with an in-band marker. The timeout interrupts in-flight tool fibers and pure busy loops alike; a value the program
already returned survives a cleanup timeout as a success with a `TimeoutExceeded` warning. CodeMode does not limit
tool-call concurrency. Data nesting at boundaries is limited to 32 levels.

## Boundaries and Non-Goals

The host owns authentication, authorization, tool selection, credentials, persistence, approval, and logging policy.
CodeMode owns interpretation, schema and plain-data boundaries, resource limits, diagnostics, and discovery. A program
can only exercise authority already present in the supplied tools - do not expose a broad tool and expect the prompt
to restrict it.

Non-goals: permission prompts and approval workflows, durable pause/resume or replay, exactly-once side effects,
application authorization policy, sandboxing arbitrary JavaScript, and compatibility with the full language or npm
ecosystem. Applications that need approval or durable consequences should model those above CodeMode and expose only
the currently authorized tools.

## Testing

From the package directory:

```sh
bun test
bun run typecheck
```
