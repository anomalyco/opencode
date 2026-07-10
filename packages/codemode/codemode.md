# CodeMode Design and Status

This is the living design and status document for `@opencode-ai/codemode` and its existing V2 OpenCode adapter.
It records current behavior, intentional boundaries, durable rationale, and material remaining work.

Completed implementation history, branch names, test counts, and closed findings belong in git, not here. Remove
completed work instead of preserving checked-off chronology.

Detailed package API documentation lives in [README.md](./README.md). OpenAPI-specific follow-ups live in
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
2. CodeMode generates model instructions, a budgeted inline catalog, and the internal `$codemode.search` tool.
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
round-robin across namespaces so one large namespace cannot starve the others. `$codemode.search` is always callable
and is advertised when the inline catalog is partial.

The intended workflow is:

1. Pick an exact signature from the inline catalog, or return `$codemode.search(...)` results and use a selected path
   in the next execution.
2. Call the exact returned path without guessing or normalizing segments.
3. Narrow `Promise<unknown>` results before reading fields.
4. Start independent calls together and await them with `Promise.all`.
5. Filter and aggregate inside the program, then return only the data needed by the model.

Search returns directly usable JavaScript paths, descriptions, and complete TypeScript signatures. It supports exact
path lookup, namespace browsing, deterministic ranking, and pagination.

### Tool execution

Calling a tool starts its Effect eagerly on a supervised fiber. The returned sandbox promise is run-once and can be
awaited directly or through the supported `Promise` combinators. At most eight tool calls execute concurrently.
Unfinished calls are drained before successful program completion, and an unhandled call failure becomes a diagnostic.

The public execution-policy knobs are `timeoutMs`, `maxToolCalls`, and `maxOutputBytes`. The package supplies no
defaults because budgets are host policy. The interpreter also enforces fixed internal boundaries for tool-call
concurrency and data nesting depth.

### Data, files, and failures

Program results and tool arguments are JSON-like data. Dates become ISO strings at host boundaries; RegExp, Map, and
Set values become `{}` as they do under JSON serialization. Promise and runtime reference values cannot cross the
boundary.

Unknown host failures and invalid outputs are sanitized. `ToolError` is the explicit channel for a safe message that a
tool wants the model to see. Diagnostic categories distinguish parsing, unsupported syntax, unknown tools, invalid
data, tool failures, limits, timeouts, and execution failures.

Files and other attachment content stay outside the interpreter. A host may collect them while child tools execute and
attach them to the outer result, but the program receives only the structured tool output.

### V2 OpenCode adapter

This section describes the `v2` branch integration. On `dev`, CodeMode is integrated through
`packages/opencode/src/tool/code-mode.ts`, where nested MCP calls run the `tool.execute.before` and
`tool.execute.after` plugin hooks.

CodeMode is integrated into V2 through `packages/core/src/tool/registry.ts` and
`packages/core/src/tool/execute.ts`:

- Core has one canonical `Tool` representation. Location-scoped producers register direct or deferred tools through
  `Tools.Service`.
- Each model step snapshots effective registrations, applies catalog visibility filtering, and exposes direct tools
  normally.
- When visible deferred tools exist, Core reserves and materializes one `execute` tool. Grouped deferred tools become
  CodeMode namespaces instead of flattened model-facing names.
- Each nested call checks that its captured registration is still current before dispatching it.
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

| Decision                                                 | Rationale                                                                                                                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Keep an owned tree-walking interpreter.                  | The product need is bounded tool orchestration, not arbitrary JavaScript. Owning the language surface keeps authority and behavior explicit.                                                                             |
| Treat schemas as the model-facing interface.             | Signatures drive correct calls; Effect Schema also provides the runtime validation boundary, while JSON Schema supports adapter interoperability.                                                                        |
| Keep authority host-owned.                               | CodeMode can only confine programs to supplied tools. The host chooses those tools, and each tool enforces its own authorization and side-effect policy.                                                                 |
| Use progressive catalog disclosure plus search.          | Large tool sets should not consume the prompt, but every namespace must remain discoverable and speculative search calls should remain valid.                                                                            |
| Start tool promises eagerly and supervise them.          | This preserves normal call-time parallelism while giving each call run-once settlement and interruption safety.                                                                                                          |
| Keep files outside the sandbox value space.              | Models should compose structured data without routing binary payloads through generated code or context.                                                                                                                 |
| Treat `execute` as the model-facing invocation boundary. | Nested calls are implementation details of one orchestration program. Reusing the outer context and bounding only the final result preserves complete intermediate data without inventing durable child-call identities. |
| Return expected failures as data.                        | Models need actionable diagnostics without exposing private host causes; host interruption and defects must still propagate correctly.                                                                                   |
| Leave execution-limit defaults to hosts.                 | Appropriate budgets depend on the surrounding product and its own cancellation, retention, and output-bounding policies.                                                                                                 |
| Skip unsupported OpenAPI operations.                     | Incorrect parameter encoding, authentication, or transport behavior is worse than a precise `skipped` reason.                                                                                                            |

## Remaining Work

Keep only material unresolved work here. Small isolated defects should be GitHub issues; adapter-only work belongs in
the adapter TODO. Delete entries when completed.

### DSL expansion

The supported JavaScript subset should grow when common model-generated code improves tool orchestration. These are
current omissions to implement, not intentional product boundaries.

- [ ] Design proper multi-stage promise pipelines. Supporting `.then`, `.catch`, and `.finally` should preserve promise
      assimilation, cancellation, failure handling, and concurrent per-item pipelines rather than adding syntax-only
      shims. Consider `Promise.any` in the same pass.
- [ ] Support async iteration and `for await...of`. Define behavior first for the runtime's supported promise and
      collection values, then extend it to bounded host streams when a stream boundary exists.
- [ ] Support callback-bearing standard-library variants that models commonly generate: the mapper argument to
      `Array.from(...)` and replacers for `JSON.stringify(...)`, including Effect-aware callbacks where needed.
- [ ] Close basic `Object` parity gaps: let `Object.values`/`Object.entries` accept arrays, make `Object.assign` validate
      and mutate its target, add `Object.is`, and let `Object.fromEntries` consume every supported iterable.
- [ ] Add deterministic modern collection conveniences where they improve orchestration: `Object.groupBy`, Set
      composition methods, and `Array.prototype.toSpliced`.
- [ ] Complete the deterministic `Math` surface beyond the current arithmetic, rounding, root, power, and logarithm
      helpers. Decide separately whether nondeterministic `Math.random` belongs in the runtime.
- [ ] Refine diagnostics so user throws, expected tool failures, unexpected host/tool defects, and genuine interpreter
      defects are distinguishable without leaking private causes.

### Tool and result contracts

- [ ] Design explicit tagged representations and size rules before allowing Blob, File, ArrayBuffer, typed arrays, or
      host streams to cross the sandbox boundary.
- [ ] Define one consistent policy for tool path segments named `__proto__`, `constructor`, or `prototype`. They must
      either be safely callable, rejected before catalog generation, or use one documented escaping rule.
