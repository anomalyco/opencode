# @opencode-ai/codemode

Effect-native confined code execution over explicit, schema-described tools.

CodeMode lets a model write a small JavaScript program that can call only the tools supplied by the host. The program can sequence calls, transform plain data, branch, loop, and run independent calls in parallel without receiving ambient filesystem, process, network, module, or application authority.

The package is currently private to this workspace. Its API is designed around one-shot and reusable execution:

```ts
// One execution
yield * CodeMode.execute({ tools, code })

// A reusable runtime
const runtime = CodeMode.make({ tools, limits })
yield * runtime.execute(code)
```

## Install

Within this workspace:

```json
{
  "dependencies": {
    "@opencode-ai/codemode": "workspace:*"
  }
}
```

Hosts interact with CodeMode through `effect` (tool `run` implementations, `Effect`-typed results), so they should depend on `effect` themselves.

## Quick Start

Define tools with Effect Schema, then place them in the object tree exposed to programs as `tools`:

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

`result` is always a `CodeMode.Result`. Program, validation, limit, and tool failures are returned as diagnostics rather than failing the Effect. Host interruption remains interruption.

Successful result values are JSON-safe data. An explicit `return` produces the program result; when it is omitted, the final executable top-level expression is returned as a model-friendly REPL convenience. Otherwise reaching the end produces `null`. Returned `undefined` and nested `undefined` values are normalized to `null` as well.

## API

### `Tool.make`

```ts
const tool = Tool.make({
  description,
  input, // Effect Schema (validating) or JSON Schema (render-only)
  output, // optional; same choice
  run,
})
```

`input` and `output` each accept a validating Effect Schema or a render-only JSON Schema document (the natural shape for adapter-provided tools whose schemas arrive as JSON Schema, e.g. MCP definitions). Effect Schema input is decoded before `run` is invoked, and `run` returns the encoded representation of an Effect Schema `output`, which CodeMode decodes and copies before exposing it to the program. JSON Schemas only shape the model-visible signature; values pass through unvalidated (they still cross the plain-data boundary).

`output` is optional. Without it the tool's signature advertises `Promise<unknown>` and the host result is exposed as-is.

The description and schemas are part of the model-visible tool contract. Keep descriptions concrete and put authorization in `run` or in the service it calls.

Public tool types are grouped under the same namespace: `Tool.Definition`, `Tool.Options`, `Tool.SchemaType`, and `Tool.JsonSchema`.

### `CodeMode.execute`

Use `CodeMode.execute` for a single execution:

```ts
const result =
  yield *
  CodeMode.execute({
    tools: { orders: { lookup: lookupOrder } },
    code: `return await tools.orders.lookup({ id: "order_42" })`,
    limits: { maxToolCalls: 10 },
    onToolCallStart: (call) => Effect.logDebug("CodeMode tool started", call),
    onToolCallEnd: (call) => Effect.logDebug("CodeMode tool settled", call),
  })
```

The Effect environment is inferred from the supplied tools. CodeMode does not erase service requirements introduced by tool implementations.

### `CodeMode.make`

Use `CodeMode.make` when the tool set and execution policy are reused:

```ts
const runtime = CodeMode.make({
  tools: { orders: { lookup: lookupOrder } },
  limits: { timeoutMs: 30_000 },
})

runtime.catalog() // structured tool descriptions
runtime.instructions() // model-facing syntax and tool guide
runtime.execute(source) // CodeMode.Result
```

`CodeMode.Input`, `CodeMode.Result`, `CodeMode.Success`, `CodeMode.Failure`, `CodeMode.Diagnostic`, and `CodeMode.DiagnosticKind` are both Effect schemas and their inferred TypeScript types. Hosts can combine `CodeMode.Input` and `CodeMode.Result` with `runtime.instructions()` and `runtime.execute()` when constructing a framework-specific agent tool.

All other CodeMode types use the same namespace: `CodeMode.Options`, `CodeMode.ExecuteOptions`, `CodeMode.Runtime`, `CodeMode.ExecutionLimits`, `CodeMode.DiscoveryOptions`, `CodeMode.DataValue`, `CodeMode.ToolDescription`, and the `CodeMode.ToolCall*` observation types.

### Results

```ts
type Result = Success | Failure

interface Success {
  readonly ok: true
  readonly value: CodeMode.DataValue
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

`toolCalls` contains the names of calls admitted by the runtime in call order. It is retained on failure so hosts can audit partial execution without exposing inputs or host failures. `truncated` is present when the value or logs were cut to fit `maxOutputBytes` (see Execution Limits).

### Tool-call hooks

`onToolCallStart` receives `{ index, name, input }` after input decoding and before tool execution. The input is decoded host-side data and may include values produced by schema transformations; applications should avoid logging sensitive tool arguments indiscriminately.

`onToolCallEnd` receives `{ index, name, input, durationMs, outcome, message? }` when an admitted call settles. `outcome` is `"success"` or `"failure"`; `message` is the model-safe failure message and is present only on failure. Interrupted calls (for example when the execution timeout fires) do not produce an end event. Both hooks are Effect-returning and must not fail.

### OpenAPI tools

`OpenAPI.fromSpec` turns an OpenAPI 3.x document into a tool subtree - one tool per operation. Dotted `operationId` values form namespaces such as `v2.session.get`. Missing IDs receive a flat method/path fallback such as `getUsersById`; names are sanitized and deduplicated. The host places the subtree under a key in its `tools` tree; that key is the model-visible namespace.

```ts
import { CodeMode, OpenAPI } from "@opencode-ai/codemode"
import { Effect } from "effect"
import { FetchHttpClient } from "effect/unstable/http"

const api = OpenAPI.fromSpec({
  spec: await Bun.file("openapi.json").json(), // parsed document (no YAML)
  auth: {
    resolve: ({ name, scopes, operation }) =>
      name === "BearerAuth" ? Effect.succeed({ type: "bearer", token }) : Effect.succeed(undefined),
  },
})

const runtime = CodeMode.make({ tools: { opencode: api.tools } })
const result = await Effect.runPromise(runtime.execute(code).pipe(Effect.provide(FetchHttpClient.layer)))
```

`fromSpec` is synchronous and returns `{ tools, skipped }`. The initial adapter supports query `form`/`deepObject`, path/header `simple`, JSON request bodies, JSON responses, and text responses; unsupported parameter encodings, non-JSON request bodies, binary responses, and streaming operations land in `skipped` instead of producing broken tools. Operation and path servers take precedence over document servers unless `baseUrl` explicitly overrides all of them. Tool inputs flatten path, query, header, and closed object-body fields into one model-facing object while retaining their HTTP locations internally. Cross-location name collisions receive a location prefix such as `path_id` and `query_id`; composed, nullable, dictionary, conditionally-required, and non-object JSON bodies remain under `body`. Auth is never model-visible. Responses are limited to 50 MiB, and non-2xx responses become safe tool failures carrying the status and a size-capped body summary. Deferred capabilities are tracked in `src/openapi/TODO.md`.

Supported bearer, basic, header, and query authentication follows OpenAPI `security` semantics and is resolved host-side via `auth.resolve` - credential storage, OAuth flows, and token refresh never enter the compiler. Cookie authentication alternatives are discarded; an operation is skipped when it has no supported alternative. See the option docstrings in `src/openapi/types.ts` for the full semantics. Generated tools require `HttpClient.HttpClient` (from `effect/unstable/http`) in the Effect environment - provide `FetchHttpClient.layer` or a custom/test client layer at execution. The supplied client owns redirect policy; credentialed hosts should reject redirects or strip credentials when the origin changes.

## Discovery

The agent-tool instructions use a budgeted catalog. Every tool namespace is always listed with its tool count regardless of budget, and as many complete, JSDoc-annotated tool signatures (each with a one-line description) as fit an estimated-token budget are inlined. Schema field descriptions and tags are part of each signature's measured cost. Selection is round-robin across namespaces for fairness: in each round (namespaces alphabetical), every namespace still holding un-inlined tools attempts to place its next-cheapest signature against the shared budget, and a namespace whose next signature does not fit drops out while the others keep going - so every namespace gets some representation before any namespace gets everything. The instructions state exactly how comprehensive the list is, both overall (`COMPLETE list` vs `PARTIAL - N of M shown`) and per namespace (`(3 tools)`, `(3 tools, 1 shown)`, `(3 tools, none shown)`).

The catalog-entry budget defaults to 2,000 estimated tokens (characters / 4, the same heuristic OpenCode uses). It applies only to full tool entries shown in the catalog; fixed instructions and namespace summaries are not counted. Override it when constructing a runtime:

```ts
const runtime = CodeMode.make({
  tools,
  discovery: { catalogBudget: 6_000 },
})
```

The budget must be a non-negative safe integer.

The runtime search tool is always registered - including when the catalog is fully inlined - so a speculative `tools.$codemode.search` call never fails as an unknown tool. It is only advertised in the instructions when the inlined list is partial:

```ts
const matches = await tools.$codemode.search({
  query: "order status",
  namespace: "orders", // optional: scope to one top-level namespace
  limit: 10,
  offset: 0,
})
```

`search` performs deterministic, additive field-weighted matching. The query is tokenized (camelCase boundaries split; every non-alphanumeric character is a separator; empties and `*` are dropped), and each term scores every tool: exact path or path-segment match (20), path substring (8), description substring (4), and searchable-text substring (2). Each term also carries naive singular variants (trailing `s`/`es` stripped), and a field check passes when the term or any variant matches - so a plural query term (`issues`) still finds a tool whose text only says `issue`, without changing the weights. The searchable text also includes the input schema's property names and their description strings, so a query naming a parameter finds its tool, and substring matching means partial words match. Scores sum across terms; matches are sorted by score (ties broken alphabetically by path), then sliced from the zero-based `offset` (default 0) to the configured `limit` (default 10). `remaining` counts matches after the current page. `next` is `{ offset }` when another page exists and `null` on the final page; spread it into the original request to preserve its query, namespace, and limit.

```ts
const request = { query: "order status", namespace: "orders", limit: 10 }
const page = await tools.$codemode.search(request)
const nextPage = page.next ? await tools.$codemode.search({ ...request, ...page.next }) : undefined
```

Each result contains the path, description, and the same generated TypeScript signature used by the inline catalog, so no second lookup is needed. Signatures use the JSDoc-annotated multiline form: each described input/output field carries its schema `description` as a `/** ... */` comment, and constraints TypeScript cannot express ride along as tags (`@deprecated`, `@default`, `@format`, `@minItems`, `@maxItems`).

```ts
tools.github.list_issues(input: {
  /** Repository owner */
  owner: string,
  /** Cursor from the previous response's pageInfo */
  after?: string,
  /**
   * Results per page
   * @default 30
   */
  perPage?: number,
}): Promise<unknown>
```

Result paths are rendered as JavaScript expressions rooted at `tools` (`tools.orders.lookup`, or `tools.context7["resolve-library-id"]` for non-identifier segments), so each `path` is directly usable as the call site. An empty query browses the catalog alphabetically by path; combined with `namespace` (`{ query: "", namespace: "orders" }`) it lists everything in that namespace. A query that names one tool path exactly (canonical path, `tools.`-prefixed path, or rendered JavaScript expression) is treated as a lookup and returns that tool alone.

The instructions are structured markdown, ordered so the workflow sits at the top and the catalog at the bottom: a `## Workflow` section with numbered steps (find a tool via search when the catalog is partial, or pick from the inlined list when it is complete; call the exact path as-is; return only the needed fields), a `## Rules` section holding only guidance the workflow does not already cover (only listed/search-result Code Mode tools and internal runtime tools exist inside `tools`; filter and aggregate collections in code; narrow `Promise<unknown>` results at runtime; run independent calls through `Promise.all`; enumerate `tools` with `Object.keys`/`for...in`; browse a namespace and paginate search results when search is advertised), a short `## Language` section that identifies the runtime as a restricted JavaScript orchestration language and names its major unavailable capabilities, and the budgeted `## Available tools` catalog. Example call forms use explicit `<namespace>.<tool>`/`<field>` placeholders - never a real or fabricated tool name.

A host cannot define its own `$codemode` top-level namespace.

## Supported Programs

CodeMode executes a deliberately bounded JavaScript subset. It supports:

- Plain data literals, property access, assignment, destructuring, and sequence expressions (the comma operator, evaluated left to right with the final value returned).
- `if`, conditional expressions, `switch`, `for`, `for...of` (arrays, strings, Maps, Sets, including assignment-form destructuring such as `for ([key, value] of entries)`), `for...in` (own keys of plain objects, index strings of arrays, and namespace/tool names of `tools` references - anything else is an error suggesting `for...of` or `Object.keys`, rather than real JS's surprising behavior of indices for strings and zero iterations for Maps/Sets), `while`, and `do...while`.
- Arrow functions and function declarations with closures, defaults, rest parameters, and destructuring.
- Optional chaining, nullish coalescing, templates, spread (arrays, strings, Maps, Sets), and `try`/`catch`.
- Common array, string, number, `Object`, `Math`, and `JSON` operations. Mutating array methods include `push`/`pop`/`shift`/`unshift`/`splice` (removes in place and returns the removed elements)/`fill`/`copyWithin`; array `keys`/`values`/`entries` return **arrays** (matching the Map/Set convention) and work with `for...of` and spread. String methods include `localeCompare` (locale/options arguments ignored), `normalize`, and the `trimLeft`/`trimRight` aliases. `Object.keys` also accepts arrays (index strings, as in JS) and tool references: `Object.keys(tools)` lists the top-level namespaces, including `$codemode`, and `Object.keys(tools.ns)` lists the names at that node (a callable tool enumerates as `[]`; an unknown path is an `UnknownTool` diagnostic). `Object.values`/`Object.entries` on a tool reference fail with a pointer at `Object.keys(tools)` and `tools.$codemode.search`.
- `Date` - `Date.now()`/`Date.parse()`/`Date.UTC()`, `new Date(...)`, the getter methods, and date arithmetic/comparison via the time value. Dates stringify as ISO (`toString` included, for determinism across host timezones).
- Regular expressions - `/literals/` and `new RegExp(...)` with `test`/`exec` (stateful `lastIndex` for `g`), plus string `match`/`matchAll`/`replace`/`replaceAll`/`split`/`search` with patterns. Match results are arrays carrying `index` and named `groups` as own properties (`input` is omitted). `replace` and `replaceAll` accept function replacers with captures, offset, input, and named groups; callbacks run sequentially, may await tool calls, and have their results coerced to strings. Invalid patterns, invalid flags, and missing-`g` calls fail with catchable errors that say what was wrong and how to fix it (escaping hints, the exact `/pattern/g` to write). Patterns run on the host engine, so pathological backtracking is bounded only by the execution timeout.
- `Map` and `Set` - construction from entries/arrays/strings, `get`/`set`/`add`/`has`/`delete`/`clear`/`size`/`forEach`, and `keys`/`values`/`entries` returning **arrays** (not iterators).
- URL helpers - `URL` resolution and mutation, linked `URLSearchParams`, `URL.canParse`/`URL.parse`, URI and URI-component encoding/decoding, and query parameter construction, lookup, mutation, sorting, callbacks, and materialization. URLSearchParams iteration methods return arrays, matching the Map/Set convention.
- First-class promises - an un-awaited `tools.ns.tool(...)` is a promise value whose call starts immediately on a supervised fiber; `await` resolves it (awaiting a non-promise value is a no-op, and `return tools.ns.tool(...)` resolves like an async-function return). `Promise.all`, `Promise.allSettled`, and `Promise.race` accept any array mixing promises and plain values (built inline, beforehand, or via spread); `Promise.resolve`/`Promise.reject` construct settled promises. `Promise.allSettled` rejection reasons are the same plain `{ name?, message }` data a `catch` binding sees, and `Promise.race` interrupts its losing in-flight calls. At most 8 tool calls run concurrently. When a program completes, still-running un-awaited calls are awaited before the execution ends; a failure from a call that was never awaited surfaces as an unhandled-rejection diagnostic.
- `throw value` and `throw new Error(message)` for explicit program failure. `Error` (and `TypeError`/`RangeError`/`SyntaxError`/`ReferenceError`/`EvalError`/`URIError`) are real constructors, callable with or without `new`; error values are plain `{ name, message }` data that additionally satisfy `instanceof Error` (a specific type matches itself and `Error`, as in JS). Every caught failure - thrown errors, interpreter runtime errors, and tool failures - is `instanceof Error` in a `catch` block; a thrown non-error value (`throw "text"`) is not, matching JS. Caught failures carry the `name` the equivalent real-JS failure would have - `JSON.parse` and invalid regex patterns produce a `SyntaxError` (satisfying `instanceof SyntaxError`), an unknown identifier a `ReferenceError`, assigning to a constant a `TypeError`, a bad `normalize` form a `RangeError`; failures with no specific analogue (including tool failures) are named `"Error"`. `instanceof` also recognizes `Date`, `RegExp`, `Map`, `Set`, `URL`, `URLSearchParams`, `Array`, `Object`, and `Promise`; any other right-hand side is a catchable error.

Inside a program, standard-library values stay live everywhere: the internal data checkpoints (`Object.*` helpers, spread, coercion inputs) preserve the instances, so `Object.values({ d: date })[0].getTime()` and a spread copy of an object holding a Map keep working. Only at the host boundary (final result, tool arguments, `JSON.stringify`) do they serialize exactly as `JSON.stringify` would: Date and URL become strings (an invalid Date becomes `null`), while RegExp, Map, Set, and URLSearchParams become `{}`. Promise values never cross a data boundary: an un-awaited promise in a result or tool argument produces a diagnostic that says to await it, instead of serializing to `{}`.

It does not expose `eval`, dynamic imports, modules, classes, generators, timers, host globals, prototype mutation, custom promise constructors (`new Promise`), promise chaining (`.then`/`.catch`/`.finally` - `await` with `try`/`catch` is the supported style), or arbitrary method calls. Unsupported syntax returns an `UnsupportedSyntax` diagnostic with a source location when available.

CodeMode is an orchestration language, not a general JavaScript runtime.

## Execution Limits

The limits are exactly three knobs:

| Limit            |              Default | Bounds                                                               |
| ---------------- | -------------------: | -------------------------------------------------------------------- |
| `timeoutMs`      |    none - no timeout | Wall-clock execution time.                                           |
| `maxToolCalls`   |     none - unlimited | Tool calls admitted during the execution.                            |
| `maxOutputBytes` | none - no truncation | Model-facing output: the serialized result value plus captured logs. |

No limit has a default, on purpose: execution budgets are host policy, not library policy - a host that wants a bound sets one; a host that can interrupt the execution fiber (as OpenCode does on user cancel) may set no timeout, and a host with its own tool-output truncation (as OpenCode has) may leave `maxOutputBytes` unset. A host with neither should set `maxOutputBytes`, or oversized results silently flood model context.

Pass only the overrides you need:

```ts
const runtime = CodeMode.make({
  tools,
  limits: {
    maxToolCalls: 20,
    timeoutMs: 60_000,
  },
})
```

Limits are safe integers. `timeoutMs` must be at least `1`; the others may be `0`. Invalid configuration throws a `RangeError` when `CodeMode.make` or `CodeMode.execute` is called. An explicitly `undefined` value is the same as leaving the limit unset.

Exceeding a configured `maxOutputBytes` never fails the execution. An oversized result value is replaced by its truncated serialized text plus an explanatory marker, logs are kept from the start until the remaining budget is exhausted (with a final marker line noting the cut), and the result carries `truncated: true`.

When configured, the timeout interrupts in-flight tool Effects, including eagerly started calls the program has not awaited (their fibers are supervised by the execution). The interpreter yields cooperatively between steps, so the timeout also interrupts pure busy loops (`while (true) {}`) - no separate work budget exists. Tool implementations remain responsible for making their external operations interruptible or independently bounded.

Two interpreter internals are fixed constants rather than knobs: at most 8 tool calls run concurrently, and values crossing a data boundary may nest at most 32 levels deep (deeper values fail as `InvalidDataValue`, which reads better than a native stack-overflow error). Neither is part of the public contract.

## Diagnostics

Failures are data:

| Kind                    | Meaning                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `ParseError`            | Source is empty or cannot be parsed.                                                                     |
| `UnsupportedSyntax`     | Parsed JavaScript is outside the supported subset.                                                       |
| `UnknownTool`           | A program referenced a tool the host did not provide.                                                    |
| `InvalidToolInput`      | Tool input failed schema decoding or safe-data copying.                                                  |
| `InvalidToolOutput`     | Tool output failed schema decoding or safe-data copying.                                                 |
| `InvalidDataValue`      | Program data violated the plain-data contract (depth, circularity, blocked properties, non-data values). |
| `ToolCallLimitExceeded` | Calls exceeded `maxToolCalls`.                                                                           |
| `TimeoutExceeded`       | Execution exceeded `timeoutMs`.                                                                          |
| `ToolFailure`           | A tool refused or failed.                                                                                |
| `ExecutionFailure`      | The program threw or another execution error occurred.                                                   |

Unknown host failures, defects, invalid outputs, and copying failures are sanitized. To return a safe operational refusal, fail with `toolError`:

```ts
import { toolError } from "@opencode-ai/codemode"

run: ({ id }) => (authorized(id) ? loadOrder(id) : Effect.fail(toolError("Order is unavailable")))
```

Only the supplied message is model-visible. The optional cause is never returned in `CodeMode.Result`; hosts should perform any required internal logging before crossing this boundary.

## Authority Boundary

CodeMode confines programs to the supplied tool tree, but it does not decide what those tools may do.

The host owns:

- Authentication and authorization.
- Tool selection and immutable scope.
- Credentials and network clients.
- Persistence, idempotency, approval, and durable side effects.
- Logging and redaction policy.

CodeMode owns:

- Parsing and interpreting the supported subset without `eval`.
- Schema boundaries around tool calls.
- Plain-data copying and blocked prototype members.
- Resource limits, call accounting, and normalized diagnostics.
- Model-facing tool discovery and instructions.

A program cannot gain authority through prose or generated code. It can only exercise authority already present in the supplied tools. Do not expose a broad tool and expect the prompt to restrict it.

## Laws

The public contract is guided by these equivalences:

- `CodeMode.execute({ ...options, code })` is equivalent to `CodeMode.make(options).execute(code)`.
- A tool implementation is not invoked unless its input has decoded successfully.
- A tool result is not visible to the program unless its output has decoded and crossed the plain-data boundary successfully.
- Unknown host failures do not become model-visible diagnostics; `ToolError` is the explicit safe-message channel.
- Host interruption remains interruption rather than a `CodeMode.Failure`.

## Non-Goals

- Generic permission prompts or approval workflows.
- Durable pause/resume, replay, or storage adapters.
- Exactly-once external side effects.
- Application authorization or product policy.
- A filesystem or process sandbox for arbitrary JavaScript.
- Compatibility with the full JavaScript language or npm ecosystem.

Applications that need approval or durable consequences should model those above CodeMode and expose only the currently authorized tools.

## Testing

From the package directory:

```sh
bun test
bun run typecheck
```

The direct suite covers public projections, discovery, schema boundaries, diagnostic sanitization, resource limits, tool-call observation, and interruption.
