# CodeMode Design and Status

This is the living design and status document for `@opencode-ai/codemode` and its existing V2 OpenCode adapter.
It records current behavior, intentional boundaries, durable rationale, and material remaining work.

Completed implementation history, branch names, test counts, and closed findings belong in git, not here. Remove
completed work instead of preserving checked-off chronology.

Detailed package API documentation lives in [README.md](./README.md), and the checkable language/runtime matrix lives
in [interpreter-support.md](./interpreter-support.md). OpenAPI-specific follow-ups live in
[src/openapi/TODO.md](./src/openapi/TODO.md).

## How CodeMode Works

### Purpose

CodeMode gives a model one `execute` tool backed by a confined JavaScript interpreter. Inside the program, the model
can call an explicit tree of schema-described tools, sequence dependent work, run independent calls concurrently,
and filter or aggregate results before returning them to the agent loop.

The goals are:

- Reduce model context consumed by large tool catalogs.
- Avoid an agent round-trip between every dependent tool call.
- Keep large intermediate results inside the program instead of sending them through model context.
- Give generated code only the authority explicitly supplied by the host.

CodeMode is an orchestration language, not a general JavaScript runtime or an application authorization system.

### Runtime

The generic runtime lives in `packages/codemode` and is host-neutral:

1. The host builds a tree of `Tool.make(...)` definitions and calls `CodeMode.make(...)` or `CodeMode.execute(...)`.
2. CodeMode generates model instructions, a budgeted inline catalog, and the global `search(...)` built-in.
3. TypeScript syntax is transpiled away, Acorn parses the resulting JavaScript, and an owned tree-walking interpreter
   executes it without `eval`.
4. Tool inputs and outputs cross schema and plain-data boundaries before they become visible on either side.
5. Execution returns `CodeMode.Result`. Expected program and tool failures are diagnostic data; host interruption
   remains Effect interruption.

Effect Schemas validate and transform tool inputs and outputs. JSON Schemas render model-facing signatures but do not
validate values; adapter-provided values still cross the plain-data boundary. A tool without an output schema is
advertised as `Promise<unknown>`.

### Discovery and model workflow

The model sees a token-budgeted catalog. Every namespace remains visible, and complete signatures are selected
round-robin across namespaces so one large namespace cannot starve the others. The global `search(...)` built-in is
always callable - synchronously, counted as an admitted tool call - and is advertised when the inline catalog is
partial.

The intended workflow is:

1. Pick an exact signature from the inline catalog, or return `search(...)` results and use a selected path in the
   next execution.
2. Call the exact returned path without guessing or normalizing segments.
3. Narrow `Promise<unknown>` results before reading fields.
4. Start independent calls together and await them with `Promise.all`.
5. Filter and aggregate inside the program, then return only the data needed by the model.

Search returns directly usable JavaScript paths, descriptions, and complete TypeScript signatures. It supports exact
path lookup, namespace browsing, deterministic ranking, and pagination.

### Tool execution

Every sandbox promise starts eagerly on a run-once fiber owned by the whole CodeMode execution, including tool calls,
async functions, chained `.then`/`.catch`/`.finally` reactions, `new Promise(executor)` constructions, and the
`Promise.all`/`allSettled`/`race`/`any`/`resolve`/`reject` statics. Nested functions therefore cannot end the lifetime
of work they started.
Independent aggregate batches overlap, and rejection is observed at the eventual `await` or chained rejection handler.
`Promise.race` and `Promise.any` use native non-cancelling settlement semantics: the deciding member wins while losers
continue running, and an all-rejected `Promise.any` rejects with an `AggregateError`. `new Promise(...)` hands the
executor first-class resolve/reject callables that may escape and settle the promise later, exactly once.
Reaction ordering matches what V8 makes observable - handlers and await continuations are deferred and run in attach
order, and a combinator settles one reaction turn after its deciding member - without promising exact microtask-count
parity beyond that. At normal completion CodeMode interrupts everything still running - race losers,
fail-fast `Promise.all` stragglers, and fire-and-forget calls alike: the program has returned, so no future await can
exist, and work whose completion matters must be awaited by the program. Waiting for any class of leftover instead
would let it hold the execution open indefinitely.
Rejections that settled un-awaited before the return become `Success.warnings` diagnostics. A fatal program failure or
host interruption closes the execution promise scope and interrupts its active fibers instead. A timeout does the
same, except that a value the program already returned is preserved alongside a `TimeoutExceeded` warning rather than
discarded. CodeMode does not limit tool-call concurrency.

The public execution-policy knobs are `timeoutMs`, `maxToolCalls`, and `maxOutputBytes`. The package supplies no
defaults because budgets are host policy. The interpreter also enforces a fixed internal data nesting depth.
`maxOutputBytes` bounds retained payload bytes, not the complete rendered message;
warning diagnostics have an equal separate budget so a large value cannot starve them, and fixed truncation notices and
host-added framing are intentionally outside the budgets.

### Data, files, and failures

Program results and tool arguments are JSON-like data. Dates become ISO strings at host boundaries; RegExp, Map, and
Set values become `{}` as they do under JSON serialization. Promise and runtime reference values cannot cross the
boundary.

Unknown host failures and invalid outputs are sanitized. `ToolError` is the explicit channel for a safe message that a
tool wants the model to see. Diagnostic categories distinguish parsing, unsupported syntax, unknown tools, invalid
data, tool failures, limits, timeouts, execution failures, and warning truncation.

Files and other attachment content stay outside the interpreter. A host may collect them while child tools execute and
attach them to the outer result, but the program receives only the structured tool output.

### V2 OpenCode adapter

CodeMode is integrated into V2 through `packages/core/src/tool/registry.ts` and
`packages/core/src/tool/execute.ts`:

- Core has one canonical `Tool` representation. Location-scoped producers register direct or deferred tools through
  `Tools.Service`.
- Each model step snapshots effective registrations, applies catalog visibility filtering, and exposes direct tools
  normally.
- When visible deferred tools exist, Core reserves and materializes one `execute` tool. Grouped deferred tools become
  CodeMode namespaces instead of flattened model-facing names.
- Nested calls execute the registered `Tool` values captured for the model request; later registrations affect later
  requests.
- Authorization and side-effect ordering remain responsibilities of the leaf tool. Catalog visibility is not execution
  authorization.
- Structured child output enters the interpreter. File parts are collected host-side and attached to the outer result.
- Nested call statuses are returned as final `execute` metadata for the TUI.
- `execute` is the one model-facing tool invocation. Nested calls reuse its invocation context and do not independently
  run registry hooks or model-output bounding; this keeps complete intermediate structured values available for
  in-program filtering. The outer `execute` settlement is the single model-output bounding boundary.
- Core supplies no CodeMode timeout or tool-call limit. User cancellation interrupts the outer invocation and its
  supervised children; the outer settlement applies Core's normal output-retention policy.

MCP tools use this canonical path: they register as grouped tools and are deferred while CodeMode is enabled. Existing
output schemas are preserved in generated signatures. Direct Core tools remain direct and are not ambient globals
inside CodeMode.

## Intentionally Unsupported

These are product boundaries rather than DSL backlog:

- Ambient filesystem, process, environment, network, credential, or application access. External work must go through
  supplied tools.
- Modules, imports, dynamic imports, `eval`, arbitrary host globals, npm packages, and prototype mutation.
- Generic permission prompts, authorization policy, durable pause/resume, replay, storage, or exactly-once external
  side effects. Hosts and tools own those concerns.
- Heuristic parsing of text tool results as JSON. A result should not silently change type based on its contents.

The OpenAPI adapter may gain more transports and encodings, but it must continue skipping operations it cannot
represent accurately rather than guessing semantics.

## Decisions and Rationale

| Decision                                                     | Rationale                                                                                                                                                                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Keep an owned tree-walking interpreter.                      | The product need is bounded tool orchestration, not arbitrary JavaScript. Owning the language surface keeps authority and behavior explicit.                                                                             |
| Treat schemas as the model-facing interface.                 | Signatures drive correct calls; Effect Schema also provides the runtime validation boundary, while JSON Schema supports adapter interoperability.                                                                        |
| Keep authority host-owned.                                   | CodeMode can only confine programs to supplied tools. The host chooses those tools, and each tool enforces its own authorization and side-effect policy.                                                                 |
| Use progressive catalog disclosure plus search.              | Large tool sets should not consume the prompt, but every namespace must remain discoverable and speculative search calls should remain valid.                                                                            |
| Start promises eagerly and supervise them for the execution. | This preserves normal call-time parallelism and run-once settlement while allowing pending work to be interrupted when the program returns.                                                                              |
| Keep files outside the sandbox value space.                  | Models should compose structured data without routing binary payloads through generated code or context.                                                                                                                 |
| Treat `execute` as the model-facing invocation boundary.     | Nested calls are implementation details of one orchestration program. Reusing the outer context and bounding only the final result preserves complete intermediate data without inventing durable child-call identities. |
| Return expected failures as data.                            | Models need actionable diagnostics without exposing private host causes; host interruption and defects must still propagate correctly.                                                                                   |
| Leave execution-limit defaults to hosts.                     | Appropriate budgets depend on the surrounding product and its own cancellation, retention, and output-bounding policies.                                                                                                 |
| Skip unsupported OpenAPI operations.                         | Incorrect parameter encoding, authentication, or transport behavior is worse than a precise `skipped` reason.                                                                                                            |

## Remaining Work

The [interpreter support checklist](./interpreter-support.md) owns concrete DSL, standard-library, semantic-correctness,
diagnostic, and data-boundary work. OpenAPI adapter work remains in [src/openapi/TODO.md](./src/openapi/TODO.md).
