# CodeMode - Status, Decisions, and Remaining Work

This document is the working plan for `@opencode-ai/codemode` and its OpenCode integration.
It captures every locked decision, everything already implemented, and a detailed TODO of what
remains - enough context that someone (human or agent) can pick up any item cold.

Tracking issue: https://github.com/anomalyco/opencode/issues/34787
Working branch: `codemode-v2` (base: `dev`)

---

## 1. What this is

CodeMode gives a model one `execute` tool that runs JavaScript/TypeScript programs against a
tree of schema-described tools (`tools.<namespace>.<tool>(input)`), instead of exposing dozens
of MCP tools individually. The point is **control flow**: sequencing, filtering, and composing
tool calls in one program instead of round-tripping through the agent loop, plus not flooding
the context window when users connect many MCP servers.

Architecture split (locked):

- **`packages/codemode` (`@opencode-ai/codemode`)** - the generic, host-agnostic runtime:
  a hand-rolled, Effect-native, tree-walking interpreter over acorn ASTs (TypeScript stripped
  via `typescript`'s `transpileModule`), the tool runtime/data boundary, discovery/search, and
  `Tool.make`. It knows nothing about OpenCode, MCP, permissions, or rendering.
- **`packages/opencode`** - the OpenCode integration: an MCP adapter that converts MCP tool
  definitions into `Tool.make(...)` definitions, permission gating, host-side attachment
  collection, the agent-facing `execute` tool, and TUI progress rendering.

This package was seeded from the experiments workspace implementation
(`experiments/agents/packages/codemode`, package `@agents/codemode`) and then modified here.
The older vendored interpreter in `packages/opencode/src/session/rune/` was superseded by this
package and was **deleted** in Wave 3 (done, see below).

---

## 2. Locked decisions

From issue #34787 and design discussion. Do not relitigate these casually.

### Core direction

- Generic CodeMode lives in its own package: `@opencode-ai/codemode` (repo scope convention;
  the issue's `@opencode/codemode` name was normalized to the `@opencode-ai/*` convention).
- **Keep the hand-rolled interpreter.** No QuickJS/V8/sandbox-engine dependency. We own and
  test the whole surface; the model only needs orchestration syntax, not a full runtime.
- Naming: `CodeMode`, `Tool`, `ToolError`, `UnknownTool` (diagnostic kind), `$codemode`
  reserved discovery namespace. (Historical names - "rune", "capability" - are dead.)
- Existing OpenCode core tools (bash/edit/patch/...) stay registered normally for v1.
  CodeMode covers MCP tools, user-registered tools, and deferred tools only.
- Test runner is `bun test`; typecheck is `tsgo --noEmit` (repo conventions). Not vitest.
- **Never reference external prior-art implementations** (other companies' code-execution
  products/blog posts) in code, comments, commit messages, or docs in this repo.

### MCP / tools

- The MCP adapter lives in OpenCode, not here. It converts MCP definitions into ordinary
  `Tool.make(...)` definitions and hands CodeMode a plain tool tree.
- Permissions stay in the OpenCode adapter (each tool's `run` wraps the permission ask).
  CodeMode stays dumb - no permission model in this package.
- Namespace collisions: last write wins (plain JS object override). No `tools.mcp.*` prefix,
  no `_2` suffixing, no cleverness. OpenCode groups flat `server_tool` MCP names into
  `tools.<server>.<tool>` namespaces before handing them over.

### Discovery / search

- **Search only - no separate `describe`.** `tools.$codemode.search({ query?, namespace?,
limit? })` over the final tool tree, owned by this package.
- Search result item shape: `{ path, description, signature }` in an `{ items, total }`
  wrapper. The `signature` string embeds the full input/output TypeScript types - in search
  results it is the pretty, JSDoc-annotated multiline form (Fix 7), so per-field schema
  `description`s and constraints (`@default`, `@format`, `@deprecated`, `@minItems`,
  `@maxItems`) ride along as field comments. The original spec's separate `input`/`output`
  raw-schema fields are deliberately NOT added: shapes are already fully expressed in the
  TypeScript signature and schema annotations now arrive as JSDoc - intent satisfied, letter
  deviated. Result `path`s render a JavaScript expression rooted at `tools` (for example
  `tools.github.list_issues` or `tools.context7["resolve-library-id"]`) so each is directly
  usable as the call site; the internal `ToolDescription.path` stays unprefixed.
- Default limit: **10** (done). Exact-path lookup goes through search too: a query equal to a
  canonical tool path, `tools.`-prefixed path, or rendered JavaScript expression returns that
  tool alone (done).
- Signatures render **native payloads**: `Promise<Issue>`, NOT `Promise<Result<Issue>>`.
  There is no result envelope; attachments never appear in return types (they are collected
  host-side, see below).
- Tools without an output schema render `unknown` as their return type.

### Schemas / Tool.make

- `Tool.make` carries rich metadata so search can render real signatures.
- Support **Effect Schema** (first-class, validating) and **JSON Schema** (initially
  render-only - used for TypeScript rendering; the adapter may validate on its own). Leave
  room for Standard Schema later.
- Tool implementations are **Effect-based** for v1 (`run` returns `Effect`). Promise
  normalization for plugin authors can come later.

### Attachments / output

- **No `output.text/file/image` API in v1.** (Deleted in Wave 2.)
- Tool calls return native structured payloads into the sandbox. Files/images emitted by
  child tools **never enter the sandbox** - the OpenCode adapter strips and accumulates them
  host-side as calls happen, then returns them on the outer `execute` tool result as ordinary
  tool-result attachments (OpenCode already has `Tool.ExecuteResult.attachments` -> vision
  plumbing in `message-v2.ts`).
- No base64 in CodeMode values, ever. The model routes nothing; it can't accidentally dump
  image bytes into context or drop attachments.

### Runtime behavior

- Limits are EXACTLY the three public knobs: `{ timeoutMs, maxToolCalls, maxOutputBytes }` -
  matching the original locked spec exactly. NO limit has a default (user direction, Fix 6
  for the first two; extended to `maxOutputBytes` in the truncation-layering fix below):
  absent = no timeout / unlimited calls / no output truncation - budgets are host policy.
  A host without its own output bounding should set `maxOutputBytes` explicitly, or
  oversized results silently flood model context. OpenCode's adapter policy (user
  direction): NO limits at all - no timeout, unlimited tool calls (each child call is
  permission-gated; user cancel interrupts the execution fiber and its children), and no
  CodeMode truncation (output bounding is OpenCode's native tool-output truncation).
  The internal limit system that Wave 2 kept behind
  an `@internal` `InternalExecutionLimits` type (maxOperations, maxDataBytes, maxValueDepth,
  maxCollectionLength, maxSourceBytes, maxAuditBytes, maxConcurrency) was deleted outright in
  Fix 5 (see Post-wave fixes). Two internals survive as fixed constants, not knobs:
  `TOOL_CALL_CONCURRENCY = 8` (the fork semaphore) and `MAX_VALUE_DEPTH = 32` (the `copyIn`
  boundary depth check, kept only because it beats a native stack-overflow RangeError as an
  error message; still reports `InvalidDataValue`).
- Truncation layering RESOLVED (user direction): CodeMode truncation is off in OpenCode.
  `execute` is a normal `Tool.define` tool, so OpenCode's native tool-output truncation
  (50KB / 2000 lines in `tool.ts` + `truncate.ts`, full output dumped to a file) applies to
  it with no special-casing - verified by tracing `wrap()` in `tool.ts:130-144` (the
  `metadata.truncated` exemption never fires for `execute`). One truncation layer, the
  host's. `maxOutputBytes` remains available for hosts without their own bounding.
- Pure-JS built-ins only. **No ambient authority**: no fs, child processes, network/fetch,
  process/env, or timers in v1. The agent has the bash tool for that.
- Forgiving JS semantics are locked (see section 3, Wave 1a/1b-i) - missing props read `undefined`,
  `typeof` never throws, NaN/Infinity flow in-sandbox, etc.
- `console.*` is captured into `logs` on the result; the host appends them to model-facing
  output. Not a tool call; costs no tool budget.
- Simple tool-call **start/end hooks** for nested progress: `onToolCallStart({ index, name,
input })` and `onToolCallEnd({ index, name, input, durationMs, outcome, message? })`.
  Interrupted calls fire no end event. No `CurrentToolCall` context service (removed in
  Wave 2).

---

## 3. Current status (what is already done on `codemode-v2`)

Everything below is committed and pushed on `codemode-v2` (six commits, in pairs of
generic-package + OpenCode-integration: waves 0-5, Fixes 4-9, then the DSL-expansion pass /
real-JS error names / truncation layering). Verification: from `packages/codemode`,
`bun test` (211 pass / 0 fail across `codemode/parity/stdlib/promise/enumeration/signature`)
and `bun run typecheck`; from `packages/opencode`, `bun run typecheck` and
`bun test test/tool/` (all green - the adapter suites are `test/tool/code-mode.test.ts`,
43 tests, and `test/tool/code-mode-integration.test.ts`, 16 tests, moved from
`test/session/` by the registry promotion; registry coverage in
`test/tool/registry.test.ts`).

### Wave 0 - scaffold (done)

- `packages/codemode` created from the experiments implementation: `src/{index,codemode,tool,
tool-error,tool-runtime}.ts`, README, AGENTS.md, tests.
- `package.json`: name `@opencode-ai/codemode`, deps `acorn@8.15.0`, `typescript: catalog:`,
  `effect: catalog:` (both repos pin effect `4.0.0-beta.83`; opencode's effect patch only
  touches `unstable/httpapi`, which this package doesn't use).
- Tests converted vitest -> `bun:test`. Only src change from verbatim: the `CurrentToolCall`
  Context.Service key string renamed to `@opencode-ai/codemode/CurrentToolCall`.

### Wave 1a - forgiving JS semantics (done)

Ported from the old opencode rune work; `test/parity.test.ts` (24 tests) is the acceptance
spec. The seeded interpreter was deliberately strict; these behaviors replaced that:

- **H1**: NaN/Infinity flow as in-sandbox values (`copyIn` admits them; `NaN`/`Infinity` are
  bindable globals; `charCodeAt` returns real NaN). Normalized to `null` only at the data
  boundary (`copyOut` - single chokepoint for final results AND tool-call arguments), matching
  `JSON.stringify`. Guards like `Number.isNaN(x)` / `parseInt(x) || 0` work.
- **H2/H3**: unknown property reads on strings/numbers/arrays -> `undefined` (incl. under
  `?.`), instead of throwing. This was the real-transcript failure: models write
  `result?.login ?? result` against JSON-string tool results.
- **H4**: `typeof undeclaredIdentifier` -> `"undefined"` (short-circuits before resolution).
- **H5**: `Boolean`/`String`/`Number` accepted as array callbacks (`filter(Boolean)`).
- **H6**: `{...null}` / `{...undefined}` object spread is a no-op. Array spread of
  null/undefined still throws (real JS throws too).

### Wave 1b-i - stdlib value types: Date, RegExp, Map, Set (done)

`src/values.ts` holds `SandboxDate/SandboxRegExp/SandboxMap/SandboxSet` (own module so both
`codemode.ts` and `tool-runtime.ts` import without a cycle). Design:

- Opaque-by-default: all four join `isRuntimeReference`, with explicit carve-outs (member
  access allowlists, Date in binary/unary ops, Map/Set in spread/for...of, console formatting,
  `containsOpaqueReference` for operator guards; the `runtimeValueBytes` byte-accounting
  carve-out died with that machinery in Fix 5).
- **JSON semantics at every boundary and checkpoint**: Date -> ISO string (invalid -> null),
  RegExp/Map/Set -> `{}`. `copyIn` also converts host `Date`/`RegExp`/`Map`/`Set` instances the
  same way (a host tool may legitimately return them). (Narrowed by the DSL-expansion pass:
  intra-sandbox checkpoints now preserve the instances; JSON forms apply at the host
  boundary only.)
- Date: `Date.now/parse/UTC`, `new Date(epoch|string|components)`, getters + UTC variants,
  `end - start`, `a < b`, `+date`; `toString` is ISO for cross-host determinism.
- RegExp: literals + `new RegExp`, `test`/`exec` (stateful `lastIndex` for `g`), string
  `match/matchAll/replace/replaceAll/split/search`. Match results are plain arrays carrying
  `index`/named `groups` as own properties (enabled by a general array own-property read fix);
  `input` omitted deliberately. Function replacers unsupported (clear error). Patterns run on
  the host engine - catastrophic backtracking is bounded only by `timeoutMs` (accepted, in
  README).
- Map/Set: full method sets; `keys/values/entries` return **arrays** (not iterators);
  `for...of` + spread work; `Object.fromEntries(map)`, `Array.from(map|set)`; SameValueZero
  keys (NaN findable). (The incremental byte totals and `maxCollectionLength`/`maxDataBytes`
  enforcement this wave added were deleted in Fix 5.)
- Rode along, same spirit: `typeof` never throws for any value (`typeof fn` -> `"function"`),
  `!` works on any value, `for...of` over strings, `{...sandboxValue}` no-op, template
  interpolation renders `/regex/` and ISO dates directly.

### Wave 2 - API layer (done)

The package's public contract, reshaped for the Wave 3 adapter. 101 tests / 0 fail after this
wave; both packages typecheck clean.

- **`Tool.make` schema flexibility** (`src/tool.ts`): `input`/`output` each accept an Effect
  Schema (validating, decoded both directions as before) OR a raw JSON Schema document
  (render-only - no validation, values pass through; rendering handles `$defs`/`definitions`
  - `$ref`). `output` is **optional** -> signature renders `Promise<unknown>` and the host
    result is exposed as-is. Discrimination via `Schema.isSchema`. New helpers exported from
    `tool.ts`: `inputTypeScript`/`outputTypeScript`/`decodeInput`/`decodeOutput`/
    `jsonSchemaToTypeScript`; `tool-runtime.ts` consumes them (no direct `Schema.*` use there
    anymore). Types `JsonSchema`/`ToolSchema` exported from the index. Note: an empty
    `Schema.Struct({})` renders as `{  } | Array<unknown>` (effect's JSON Schema emission) -
    cosmetic, fixed in Wave 4.
- **`output.*` API deleted**: `OutputItem`(+Schema), result `output` fields, the `output`
  global/namespace dispatch, `invokeOutput`/`outputItem`/helpers, interpreter output fields,
  instructions line, README section, seeded tests. AGENTS.md keeps a rephrased
  future-design note (channel name stays `output` if it ever returns).
- **Hooks**: `CurrentToolCall` removed entirely (class, provideService, `Services` Exclude
  special-casing, index export). `onToolCall` -> `onToolCallStart({ index, name, input })` +
  `onToolCallEnd({ index, name, input, durationMs, outcome: "success"|"failure", message? })`.
  End fires symmetrically via `Effect.tap`/`tapError` around the settling portion (host run +
  output decode + boundary copy; search too - its post-record body is wrapped in `Effect.try`
  so failures are typed and observable). `message` is the model-safe failure message
  (`ToolError`/`ToolRuntimeError` message, else "Tool execution failed"). Interrupted calls
  fire no end event (timeout kills the whole execution anyway).
- **Limits collapse**: public `ExecutionLimits` = `{ timeoutMs?, maxToolCalls?,
maxOutputBytes? }` (defaults 10_000 / 100 / 32_000). This wave kept the other knobs as
  internal defaults reachable through an `@internal` `InternalExecutionLimits` type; Fix 5
  later deleted that type and the internal limit system entirely.
- **`maxOutputBytes` truncation** (CodeMode-owned, never fails): applied via `boundOutput` in
  a final `Effect.map` over every result path (success/timeout/normalized failure). Oversized
  serialized values become truncated text + ` [result truncated: N bytes exceeds the M-byte
output limit; return a smaller value]`; logs keep leading lines within the remaining budget
  - `[logs truncated: showing K of N lines]`; result gains `truncated: true` (also added to
    `ExecuteResultSchema`). UTF-8-safe truncation (no split code points). (The in-sandbox
    `maxDataBytes` check that used to throw first on oversized raw values died in Fix 5 -
    truncation is now the only result-size mechanism.)
- **Search polish**: default limit 12 -> **10** (`defaultSearchLimit`); exact-path lookup - a
  trimmed query equal to one tool path (optionally `tools.`-prefixed) returns that tool alone
  (`total: 1`), bypassing ranking. Tokenization/ranking/shape unchanged.

### Wave 3 - OpenCode MCP adapter (done)

`packages/opencode/src/session/code-mode.ts` rewritten as a thin adapter over this package;
the vendored rune interpreter is gone. Same `define(mcpTools, mcpDefs, servers)` signature, so
`tools.ts` gating (flag on + MCP tools exist -> single `execute` tool, early-return suppresses
per-MCP registration; MCP resource tools unaffected) is unchanged.

- **Tool tree**: `groupByServer` (longest-sanitized-prefix, ported) groups flat `server_tool`
  keys into `CatalogEntry`s carrying the raw MCP `inputSchema`/`outputSchema` as render-only
  JSON Schema; `toolTree` turns each into `Tool.make({ description, input, output?, run })`
  under `tools.<server>.<tool>`. The agent-facing description is
  `CodeMode.make({ tools }).instructions()` over a preview tree (placeholder runs, never
  invoked) - so signature rendering, the inline-vs-search switch, and `$codemode.search`
  availability all come from this package and stay consistent with execution.
- **`run` path**: per-child permission ask first (`ctx.ask({ permission: entry.key, patterns:
["*"], always: ["*"] })`, exactly the old gating; approving `execute` approves no child).
  Denials and host failures are mapped to `toolError(message)` so they surface as safe,
  catchable in-program failures (MCP `isError` text propagates as `e.message`; without this
  they'd be sanitized to "Tool execution failed"). Dispatch reuses the ai-sdk wrapper from
  `catalog.convertTool` (`entry.tool.execute!`), which owns callTool timeouts/progress-reset.
- **Result shaping** (`toSandboxResult`): prefer `structuredContent`; else joined text
  content; media (image/audio/resource blob/resource_link) NEVER enters the sandbox - blocks
  are stripped into a per-execution `Attachment[]` accumulator, and a media-only result
  becomes a marker payload (`"[1 image attached to the result]"`, noun/count adjusted). An
  MCP-shaped result with nothing extractable becomes `null`; non-MCP values pass through.
  No handles, no `Result<T>` envelope, no base64 in the sandbox, no data-size tuning (the
  `maxDataBytes` budget that existed at the time was deleted in Fix 5).
- **Execute result**: `{ output: formatValue(value) + trailing "Logs:" section (success AND
error - logs are plain pre-formatted lines now), attachments: accumulated }` through the
  existing `Tool.ExecuteResult.attachments` -> `message-v2.ts` vision plumbing; attachments
  ride on both success and error results. Diagnostic `suggestions` not already contained in
  the message are appended to error output. Native outer truncation stays on (adapter never
  sets `metadata.truncated`); CodeMode's own `maxOutputBytes` (32 KB default at the time)
  cut first - since the truncation-layering fix, native truncation is the only layer.
  Limits: `{ timeoutMs: 30_000 }` at the time (matched the default MCP request timeout);
  killed in Fix 6 - the adapter now passes no limits at all.
- **Progress**: `onToolCallStart`/`onToolCallEnd` -> `ctx.metadata({ toolCalls })` with
  `{ tool, status: running|completed|error, input? }` per call index - the exact shape the
  TUI `Execute` component (`packages/tui/src/routes/session/index.tsx`) already renders.
  `$codemode.search` calls stream through the same channel.
- **Deletions/deps**: `src/session/rune/` (all five files) and
  `test/session/rune-parity.test.ts` (superseded by this package's `test/parity.test.ts`)
  deleted; `acorn` removed from opencode deps, `typescript` moved back to devDependencies,
  `"@opencode-ai/codemode": "workspace:*"` added; `bun install` run (lockfile updated).
- **Tests**: both opencode suites rewritten against the adapter design -
  `code-mode.test.ts` (34: grouping, description/signature rendering incl. the large-catalog
  search fallback, execution, permission flow + denial, metadata streaming, attachment
  accumulation + media-only marker, logs on success/error, truncation marker,
  `toSandboxResult`/`formatValue`/`withLogs` units) and `code-mode-integration.test.ts`
  (16: real in-memory MCP server; native structured results, attachment accumulation, isError
  propagation, logs, permissions, live metadata). Old envelope/attachment-handle/`$rune`
  describe/`renderType`/`rankTools` tests died with the old design (58+17+24 -> 34+16).

### Wave 4 - instructions/prompting + polish (done)

Instructions are now the budgeted-catalog + prompting-guidance form; verified e2e against a
real MCP config. Package still 101 tests / 0 fail; opencode adapter suites still 34 + 16; both
packages typecheck clean.

- **Budgeted catalog** (`discoveryPlan` in `tool-runtime.ts`): the all-or-nothing
  inline/search modes are gone - `DiscoveryMode` deleted, `DiscoveryOptions` is just
  `{ maxInlineCatalogBytes? }` (default 16,000 UTF-8 bytes; later converted to
  `maxInlineCatalogTokens`, default 4,000 estimated tokens - see Post-wave fixes). Port of
  the old opencode
  `describe()` `PREVIEW_BUDGET` algorithm, adapted to `ToolDescription`: every namespace is
  ALWAYS listed with its tool count; full signature lines
  (`  - <signature> // <first line of description, capped at 120 chars>`) are inlined
  cheapest-first (line byte length, path tiebreak) within each namespace, namespaces processed
  alphabetically; once one line does not fit, inlining stops for every remaining namespace
  (counts only), exactly like the ported algorithm (this stop-everything behavior was later
  replaced by round-robin fairness in Fix 8). The header states comprehensiveness
  precisely: "Available tools (COMPLETE list - ...)" vs "Available tools (PARTIAL - N of M
  shown; find the rest with tools.$codemode.search)"; namespace labels are `(N tools)` /
  `(N tools, K shown)` / `(N tools, none shown)`. An empty tree renders "No tools are
  currently available."
- **Search always registered** (documented decision): `DiscoveryPlan.searchIndex` is required
  and built unconditionally (new exported `ToolRuntime.searchIndex(tools)`; `SearchEntry` type
  exported); `CodeMode.execute` (one-shot) passes it too, preserving the
  `execute`==`make().execute` law. A speculative `tools.$codemode.search` call on a small
  catalog now succeeds instead of `UnknownTool`, and unknown-tool suggestions always point at
  search. Search is _advertised_ in the instructions only when the inlined list is PARTIAL,
  keeping small-catalog instructions tight.
- **Prompting content** in `instructions()`, mapping 1:1 to the section 5 transcript failures:
  parse-string-results-as-JSON, return-small, console-for-intermediates, and
  read-the-description-before-calling guidance. (The flat prose layout this wave produced
  was later replaced wholesale by the markdown-section restructure - see Post-wave fixes -
  which also deleted this wave's worked example.)
- **Cosmetic renderer fixes** (`renderSchema` in `tool.ts`): an object schema with no
  properties renders `{}` (was `{  }`), and the empty `Schema.Struct({})` emission
  (`anyOf: [{ type: "object" }, { type: "array" }]`, no properties/items) collapses to `{}`
  (was `{  } | Array<unknown>`).
- **Tests**: 4 package discovery tests rewritten for the budgeted behavior (COMPLETE small
  catalog + search-still-registered; PARTIAL at budget 0; cheapest-first selection +
  per-namespace labels + budget-exhaustion stopping later namespaces; mode-validation
  assertion dropped); 3 opencode description assertions updated (COMPLETE/PARTIAL headers,
  namespace labels, `(input: {})` rendering, cheapest-first op_0 shown / op_149 not).
- **E2E (verified, headless)**: from the repo root with `OPENCODE_EXPERIMENTAL_CODE_MODE=1`,
  the scratch `.opencode/opencode.jsonc` (context7, github, playwright, sentry, memory,
  sequential-thinking; left uncommitted/as-is), and `bun packages/opencode/src/index.ts run
--dangerously-skip-permissions -m opencode/claude-sonnet-4-5 "..."`. Confirmed: a single
  `execute` tool registered alongside core tools (per-MCP registration suppressed; MCP
  resource tools unaffected); the live description read back as "Available tools (PARTIAL -
  56 of 88 shown; find the rest with tools.$codemode.search):" with correct per-namespace
  labels (context7/github/memory fully shown; playwright/sentry/sequential-thinking "none
  shown" - the alphabetical-exhaustion starvation Fix 8 later replaced with round-robin
  fairness); programs executed with in-program `$codemode.search`
  calls and returned the correct answer. NOT verified e2e (headless only; covered by
  unit/integration tests instead): TUI child-call rendering, attachments becoming visible
  images, output truncation.

### Wave 5 - Promise generalization (done)

First-class promise values in the interpreter; the direct-tool-call-only `Promise.all`
restriction (and its bespoke AST checks) is gone. Package suite is 136 tests / 0 fail (35 new
in `test/promise.test.ts`); adapter suites and both typechecks unchanged/green; the opencode
adapter needed **no changes**.

- **Decision: eager fork** (`const p = tools.a.b(x)` starts the call immediately on a
  supervised child fiber; `await p` observes its settlement). Chosen over lazy because:
  (1) it's spec-faithful - JS promise work starts at call time, so
  `const a = t1(); const b = t2(); return [await a, await b]` gets real parallelism instead of
  silently sequential awaits; (2) run-once is free - a fiber settles exactly once and
  `Fiber.await` is idempotent, so `await p` twice or `Promise.all([p, p])` can never re-invoke
  the tool (lazy needs a deferred/latch to match); (3) effect's structured concurrency does the
  hard part - `Effect.forkChild` children are auto-supervised (interrupted when the parent
  fiber exits) and `Effect.timeoutOrElse` is `raceFirst`, which runs the program on its own
  raced fiber, so forked calls cannot escape the timeout (tested: in-flight forks are
  interrupted, awaited or abandoned, direct or inside `Promise.all`).
- **Mechanics**: `SandboxPromise` in `values.ts` (fiber-backed for tool calls; fiberless
  `immediate` effect for `Promise.resolve`/`reject`). Forks run
  `semaphore.withPermit(invoke)` with `startImmediately: true` - a per-execution
  `Semaphore.makeUnsafe(TOOL_CALL_CONCURRENCY)` (fixed 8, see Fix 5) caps live calls (the
  "Effect.all or equivalent" cap lives where the work is, so combinator joins can be
  sequential without losing parallelism), and the tool-call-count charge (`recordCall`) plus
  `onToolCallStart` fire at the call site before any await. `await` of a non-promise is a passthrough no-op; a returned
  top-level promise resolves like an async-function return (`return tools.a.b(x)` works
  without await).
- **Promise combinators are normal functions over values**: `Promise.all`/`allSettled`/`race`
  accept any array (or spreadable collection) mixing promises and plain data - inline, built
  beforehand, spread, nested in variables. `allSettled` yields
  `{ status: "fulfilled", value } | { status: "rejected", reason }` with reasons produced by
  the same `caughtErrorValue` helper the `catch` binding uses (factored out of
  `evaluateTryStatement`). `race` resolves/rejects with the first settlement and interrupts
  losing in-flight calls; awaiting an interrupted loser afterwards is a catchable program
  failure ("interrupted because another value settled a Promise.race first"), while any other
  interrupt-only settlement keeps propagating as interruption (preserving the
  host-interruption law). `Promise.resolve` flattens promises; `Promise.reject` rejects with
  the reason via `ProgramThrow`.
- **Opaqueness/boundaries**: promises are runtime references - `typeof` -> `"object"` (real JS),
  operators reject them, `copyIn` raises an await-hinting `InvalidDataValue` ("contains an
  un-awaited Promise; await tool calls (...) before using their results") for results, tool
  arguments, and `JSON.stringify` instead of `{}`. Property access on a promise is a
  deliberate error (not the forgiving `undefined`): `.then/.catch/.finally` ->
  `UnsupportedSyntax` pointing at `await` + try/catch; anything else -> "await it first".
  `new Promise(...)` -> UnsupportedSyntax ("tool calls already return promises");
  `Promise.<unknown>` lists the five available statics. `console.log(p)` prints
  `[Promise (await it to get its value)]`.
- **Program-end drain**: on successful completion the interpreter awaits still-running
  un-awaited fibers (like a runtime waiting on in-flight I/O at exit), so fire-and-forget
  calls complete deterministically; a failure nobody could have handled surfaces as an
  "Unhandled rejection from an un-awaited tool call: ..." diagnostic (kind preserved,
  suggestion says to await) - keeping pre-wave failure visibility for un-awaited
  statement-position calls. Settlement observation (await/all/allSettled/race) marks a
  promise handled; failed executions skip the drain and children are interrupted by
  supervision.
- **Deletions/updates**: `evaluatePromiseAll`, `evaluateParallelMap`, `isToolCallExpression`,
  `isToolPath`, `forkForParallelCallback`, and `PromiseAllReference` deleted
  (`PromiseMethodReference` over `all/allSettled/race/resolve/reject` replaces it);
  `supportedSyntaxMessage`, the two instructions lines in `tool-runtime.ts`, and README
  "Supported Programs" rewritten for the new surface.
- **Known divergences (deliberate)**: `p === q` on promises throws the operators-need-data
  diagnostic instead of comparing identity; `{...promise}` errors instead of JS's silent `{}`;
  a per-iteration `await` inside `items.map(async (i) => await tools.x(i))` runs sequentially
  (interpreter callbacks compose synchronously) - the parallel idiom is mapping to un-awaited
  calls and awaiting `Promise.all`, which the instructions show.

### Post-wave fixes

- **Key enumeration: `Object.keys(tools)` + `for...in` (done).** Motivating transcript: a
  model tried to enumerate tool namespaces with `Object.keys(tools)` (failed with the generic
  "Object.keys input must contain plain objects only." - `tools` is a `ToolReference`, not
  plain data) and then `for (const key in tools)` ("Syntax 'ForInStatement' is not
  supported"), and had to fall back to guessing namespace names from the instructions -
  defeating discovery. Fixes, all in this package:
  - `ToolRuntime.make` now returns a `keys(path)` capability (`namespaceKeys` in
    `tool-runtime.ts`) threaded into the `Interpreter` alongside `invoke` - the interpreter
    still never holds the host tool tree. `Object.keys(tools)` yields the top-level namespace
    names (never `$codemode`, which is virtual - but `Object.keys(tools.$codemode)` yields
    `["search"]`), `Object.keys(tools.ns)` the names at that node; a callable tool leaf
    enumerates as `[]` (like `Object.keys` of a JS function); an unknown path throws an
    `UnknownTool` diagnostic suggesting `Object.keys(tools)` and `$codemode.search` (matching
    call-time unknown-tool behavior rather than silently returning `[]`).
  - `Object.values`/`Object.entries` (and every other `Object.*` helper) on a tool reference
    now fail with "...not plain data. Use Object.keys(tools) for names, or
    tools.$codemode.search({ query }) for signatures." instead of the generic message.
  - `Object.keys(array)` returns index strings (`["0", "1", ...]`) like real JS (was a
    Backlog item).
  - `for...in` (ForInStatement) iterates own enumerable string keys of plain objects, index
    strings of arrays, and namespace/tool names of tool references - sharing the interpreter's
    `enumerableKeys` helper with the `Object.keys` tool path. const/let declarations and bare
    identifiers bind the key; break/continue work. Anything else (strings, Map/Set, numbers,
    null, ...) is a clear error suggesting `for...of` or `Object.keys` - deliberately smaller
    than real JS (which yields indices for strings and zero iterations for Maps/Sets/null).
  - `supportedSyntaxMessage`, the instructions loops line, and README "Supported Programs"
    mention the new surface; tests in `test/enumeration.test.ts` (14, incl. the exact
    transcript program) plus one adapter-level assertion that `Object.keys(tools)` returns
    MCP server names.

- **Search ranking, namespace scoping, prefixed result paths (done).**
  Motivation: the Wave 4 e2e run showed a model retrying calls because search-result paths
  lacked the `tools.` prefix (a Backlog item), and the word-set ranker missed
  parameter-name and partial-word queries. Fixes:
  - **Ranking ported from the pre-rebuild implementation** (the `searchTextFor`/`tokenize`/
    `rankTools` algorithm in `packages/opencode/src/session/code-mode.ts` at git HEAD),
    replacing the word-set ranker in `tool-runtime.ts`. Searchable text per tool = path +
    description + input-schema property names + their `description` strings - extracted by
    the new `inputProperties` helper in `tool.ts` (Effect Schemas via
    `Schema.toJsonSchemaDocument`, the same emission signature rendering uses; JSON Schemas
    read `properties` directly, resolving a trivial top-level `$ref`; try/catch falls back to
    path + description). Queries tokenize on camelCase boundaries + non-alphanumeric
    separators (empties and `*` dropped). Additive per-term scoring: exact path or
    path-segment match 20, path substring 8, description substring 4, searchable-text
    substring 2; summed across terms, filtered to score > 0, sorted score desc then path asc
    (Fix 8 later made each field check accept the term OR a naive singular variant).
    An empty query now browses ALPHABETICALLY by path (was declaration order). Kept:
    `{ path, description, signature }` result items, default limit 10, exact-path instant
    lookup, input validation errors.
  - **Namespace scoping**: `tools.$codemode.search({ query?, namespace?, limit? })` -
    `namespace` (validated as a string when provided) filters `SearchEntry`s to one top-level
    namespace before ranking; `{ query: "", namespace: "github" }` lists that namespace
    alphabetically. `searchSignature` updated.
  - **Callable result paths**: search-result `path`s are rendered as JavaScript expressions
    rooted at `tools` (`tools.github.list_issues`, or bracket notation for non-identifier
    segments), directly usable as the call site. Internal `ToolDescription.path` stays
    unprefixed; only the search RESULT items are rendered this way. Exact-path queries accept
    canonical paths and rendered expressions.
  - **Instructions** (`discoveryPlan`): an explicit calling-convention line and a browse
    hint on the search advertisement (both since absorbed into the `## Rules` section by
    the instructions restructure below).
  - **Tests**: package search/discovery tests updated (prefixed paths, alphabetical browse)
    plus new coverage for namespace scoping, parameter-name matching, partial-word substring
    matching, alphabetical empty-query order, and prefixed exact-path lookup; one adapter
    assertion updated to the prefixed path (suites stay 35 + 16, green).

- **Instructions restructure: markdown sections, placeholder-only call forms (done).**
  The flat prose instructions (which mixed a real catalog tool with fabricated result
  fields in the worked example) are replaced by structured markdown in `discoveryPlan`,
  ordered so the workflow sits at the top (the least likely part of a long description to
  be truncated or skimmed away) and the catalog at the bottom (the per-section content
  described here was later condensed by Fix 8 - Workflow/Rules deduped, Syntax inverted):
  - **Intro** (2 lines): "Write a CodeMode program... Return code only." + "Execute
    JavaScript in a confined runtime with access to the tools listed below under
    `tools.*`." (the second line drops the tools clause when the tree is empty).
  - **`## Workflow`**: numbered steps - find a tool via `tools.$codemode.search` -> read
    the `{ path, description, signature }` matches -> call by path -> `typeof res ===
"string" ? JSON.parse(res) : res` -> return only the needed fields. When the catalog is
    COMPLETE the search/read steps collapse into "Pick a tool from the list under
    `## Available tools`" and the steps renumber (4 instead of 5).
  - **`## Rules`**: call-by-exact-path; TEXT-is-JSON -> JSON.parse; return small (never raw
    payloads); filter/aggregate large collections in code instead of per-item round-trips;
    console.log/warn/error/dir/table for intermediates; `Promise.all` parallelism (no
    .then/.catch - await + try/catch); `Object.keys(tools)`/`for...in` enumeration;
    browse-one-namespace via search (PARTIAL only); and host-side media handling (files/
    images never enter the program; a media-only call yields a small text marker - wording
    verified against the adapter's `toSandboxResult`/`mediaMarker`).
  - **`## Syntax`**: the dense syntax lines unchanged, minus the Promise.all and console
    lines (moved into Rules) and the `for (const ns in tools)` fragment (redundant with
    the enumeration rule).
  - **`## Available tools`**: the budgeted catalog unchanged, with the COMPLETE/PARTIAL
    header merged into the section heading (no trailing colon); the search-signature
    advertisement follows when PARTIAL (its description-reading and browse clauses moved
    to Workflow/Rules).
  - Every call form in Workflow/Rules uses explicit `<namespace>.<tool>`/`<field>`
    placeholders - the example builder that derived a worked example from the first inlined
    catalog tool (`exampleArguments` + the example-selection machinery) is DELETED, so no
    real catalog tool is cherry-picked into examples and no fabricated names or fields
    appear anywhere in the instructions. Zero tools keep "No tools are currently
    available." under minimal sections (intro + Syntax + Available tools).
  - **Tests**: the package worked-example test replaced by section-structure/placeholder
    assertions (section order; JSON.parse + return-small rules present; no
    `total_count`/`list_issues`/real-tool example lines; browse hint only when PARTIAL;
    zero-tool minimal sections) - 156 pass / 0 fail; adapter suites gain the same
    assertions on the built description (still 35 + 16, green).

**Fix 4 - token-budgeted catalog (was bytes)** (user direction: signatures need a token
budget; namespaces must always be present):

- `src/token.ts` added: copy of `@opencode-ai/core/util/token` (`round(chars / 4)`), so
  the package stays dependency-free; keep in sync if the core heuristic changes.
- `DiscoveryOptions.maxInlineCatalogBytes` -> `maxInlineCatalogTokens` (default 4,000
  estimated tokens ~ the old 16,000 bytes at 4 chars/token - behavior parity, not a size
  reduction). `discoveryPlan` charges `estimate(catalogLine(tool))` per line; cheapest-first
  - stop-on-first-miss unchanged at the time (stop-on-first-miss replaced by round-robin in
    Fix 8). Namespace stub lines were and remain unbudgeted - every
    namespace always appears with its tool count, even at budget 0 (asserted in package and
    adapter tests).
- Ripple: chars/4 rounding erases small line-length differences, so equal-cost lines fall
  to the lexicographic path tiebreak; the adapter's PARTIAL test now asserts the
  lexicographic tail (`op_99`) is excluded instead of `op_149`. Fixed-prose measurements
  (2026-07): preamble ~44 + Workflow ~146 + Rules ~362 + Syntax ~453 ~ 1,100 tokens fixed;
  worst-case net description ~ fixed + 4,000 ~ 5,100 estimated tokens.

**Fix 5 - internal limits removed** (user direction: only the three PUBLIC limits survive as
configurable knobs; the internal limit system dies):

- `ExecutionLimits` (`timeoutMs` 10_000 / `maxToolCalls` 100 / `maxOutputBytes` 32_000 at
  the time; Fix 6 later removed the first two defaults. Same validation: safe integers,
  timeoutMs >= 1, others >= 0, RangeError otherwise) is now
  the ENTIRE limit surface - exactly the shape section 2's original locked spec named.
  `ResolvedExecutionLimits` shrank to those three fields; the `@internal`
  `InternalExecutionLimits` type is deleted.
- **Deleted outright**: `maxOperations` and the whole operation-budget machinery
  (`recordWork`/`recordOperation`/`budget.operations`, plus the `workUnits`/
  `cheapArrayMethods` cost helpers); `maxSourceBytes` (the pre-parse source-size check);
  `maxDataBytes` (every byte-accounting path: `runtimeValueBytes`, `boundedProgramValue`,
  the container-size caches (`containerSizes`/`objectCounts`), Map/Set incremental `bytes`
  fields in `values.ts`, string-growth `limitString` checks, tool-argument/result byte
  checks in `tool-runtime.ts`, and the final-result size check); `maxAuditBytes` (log and
  audit-trail byte accounting - `toolCalls` records and the start/end hooks are unchanged);
  `maxCollectionLength` (every array-length/object-field-count check - this knob was
  actively harmful: an MCP tool returning 20k rows failed). The `OperationLimitExceeded`
  and `AuditLimitExceeded` diagnostic kinds are gone from the `DiagnosticKind` union and
  `ExecuteResultSchema` (fine - the package is unreleased).
- **Fixed constants, not knobs**: `TOOL_CALL_CONCURRENCY = 8` (codemode.ts; the fork
  semaphore) and `MAX_VALUE_DEPTH = 32` (tool-runtime.ts; the `copyIn` depth check - kept
  only because it produces a clearer error than a native stack-overflow RangeError; still
  `InvalidDataValue`). The `DataLimits` plumbing through `tool-runtime.ts` is gone -
  `copyIn(value, label)` needs no limits argument, and `ToolRuntime.make` takes just
  `(tools, maxToolCalls, hooks?, searchIndex?)`.
- **Verified fact**: timeout interruption does NOT depend on the operation budget - the
  Effect fiber runtime auto-yields between interpreter steps, so `timeoutMs` interrupts
  even a pure `while (true) {}` loop (empirically verified: a 200ms timeout fired at
  ~225ms with maxOperations set to MAX_SAFE_INTEGER before the deletion). A regression
  test in `codemode.test.ts` asserts exactly this (`while(true){}` + `timeoutMs: 200` ->
  `TimeoutExceeded`, elapsed well under a few seconds).
- **Kept (correctness, not budgets)**: circular detection (`copyIn` walks +
  `rejectCircularInsertion` on mutations), plain-objects-only, blocked properties
  (`__proto__`/`constructor`/`prototype`), data-only checks, and all three public-limit
  behaviors unchanged.
- Behavior deltas beyond the intended kills: in-sandbox structures deeper than 32 levels
  now fail at the data boundary (`copyIn`) instead of at construction; array index
  assignment allows any non-negative integer index (holes permitted, message now "must be
  a non-negative integer"); interpreter-produced deep/hostile structures that overflow the
  native stack during a walk still normalize to the existing "Execution exceeded the
  maximum nesting depth." data diagnostic - failures remain data everywhere.
- Tests: deleted the knob-only tests (stdlib Map/Set collection-length growth x2,
  enumeration operation-budget, codemode maxDataBytes/maxSourceBytes/maxOperations/
  maxConcurrency-RangeError assertions, and the adapter's runaway-loop-via-operation-limit
  test - superseded by the package timeout regression test); rewrote the helpers that used
  `InternalExecutionLimits` as a convenience to plain `ExecutionLimits`
  (promise/enumeration/stdlib run helpers). Package suite: 154 pass / 0 fail; adapter
  suites: 34 + 16.

**Fix 6 - no default timeout / tool-call cap** (user direction): `timeoutMs` and
`maxToolCalls` lost their defaults (were 10_000 / 100) - absent now means no timeout /
unlimited calls. Budgets are host policy, not library policy; `maxOutputBytes` kept its
32,000 default at the time (removed later - see the truncation-layering entry: absent now
means no truncation). `ResolvedExecutionLimits` carries `number | undefined` for both, the
timeout wrapper is only applied when configured, and `ToolRuntime.make` treats undefined
`maxToolCalls` as uncapped. Validation is unchanged when values ARE provided (safe integers,
timeoutMs >= 1, others >= 0). The OpenCode adapter is unaffected in behavior it sets
(explicit 30s timeout) but now runs with unlimited tool calls. Immediately after, per user
direction, the adapter's 30s timeout was killed too: `CODE_LIMITS` is deleted and OpenCode
passes NO limits - no timeout, no tool-call cap. Rationale: user cancel interrupts the
execution fiber and structured concurrency takes the program and in-flight child calls down
with it; every child call is permission-gated; output truncation (32KB default) is the only
active bound. New regression test: 150 tool calls succeed with no limits configured (would
have tripped the old default 100). Package suite: 155 pass / 0 fail.

**Fix 7 - JSDoc-annotated search signatures**: `tools.$codemode.search` result signatures are
now the pretty, indented multiline form with per-field JSDoc - ported from the pre-rebuild
rune renderer in this repo's git history (`renderType(def, { pretty })`/`docTags`/`jsdoc`/
`renderObject`), adapted to the current renderer's conventions (`Array<T>`, `unknown`
fallback, existing `$defs`/`$ref` handling and empty-object `{}` collapse; the old
`Result<T>`/`returnType` machinery was deliberately not ported - payloads stay native).
Semantics: each described input/output field carries its schema `description` as a
`/** ... */` comment at the right indent (nested objects recurse deeper); constraints TS can't
express surface as JSDoc tags - `@deprecated`, `@default <json>` (unserializable defaults
skipped), `@format`, `@minItems`/`@maxItems`; `*/` inside text is neutralized to `* /`;
multiline descriptions become `*`-prefixed blocks with blank edges trimmed; undescribed,
untagged fields get no comment. Implementation: `renderSchema` in `tool.ts` grew a
`RenderContext` (`{ definitions, pretty }`), a `MAX_RENDER_DEPTH = 8` recursion ceiling plus
a `$ref` `seen` guard (the renderer previously had neither - a cyclic `$defs` would have
looped; it now degrades to the ref name/`unknown`), and try/catch totality on the public
helpers (`toTypeScript`/`jsonSchemaToTypeScript`/`inputTypeScript`/`outputTypeScript` never
throw - pathological schemas render `unknown`); each helper takes an optional trailing
`pretty = false` parameter, so existing callers are unchanged and compact output stays
byte-identical (inline `catalogLine`s and the token budget depend on it). `SearchEntry`
gained an eagerly-computed `signature` field (built once per tool at index-build time in
`toSearchEntry` - rendering is cheap and the search hot path stays allocation-free); both
ranked results and exact-path lookups serve it. Works for both tool kinds: Effect Schema
annotations (`Schema.String.annotate({ description })`) flow through the emitted JSON
Schema, and raw JSON Schema (MCP) property metadata is read directly - both covered in
`test/signature.test.ts` (12 tests) plus one strengthened adapter assertion (MCP property
description appears as JSDoc in a live search result; the tool description/catalog contains
no `/**`). README search section updated with an example. Package suite: 167 pass / 0 fail;
adapter suites: 34 + 16.

**Fix 8 - condensed instructions + round-robin catalog fairness + plural-aware search**
(user direction: the fixed instruction prose was too verbose; two discovery fixes ride
along). All in `tool-runtime.ts`; no interpreter changes.

- **Syntax section inverted**: the three dense allowlist lines (~453 estimated tokens)
  are replaced by four short lines (~188) built on "models already know JavaScript; name
  only what is unusual or missing": (1) standard modern JS works - functions/closures,
  destructuring, template literals, loops, try/catch, spread, optional chaining, the
  usual Array/String/Object/Math/JSON methods, plus Date/RegExp/Map/Set and
  Promise.all/allSettled/race/resolve/reject; (2) TypeScript type annotations are
  stripped before execution, decorators are not supported; (3) NOT supported (each fails
  with a message naming the alternative): classes, generators, for await...of,
  .then/.catch/.finally (use await with try/catch), `x instanceof Error` (caught errors
  are plain `{ name, message }` objects), splice; (4) the data-boundary note (Dates ->
  ISO strings; Map/Set/RegExp -> `{}`). Every claim was verified against the interpreter
  before writing: probed empirically - classes/generators/for-await/.then/.catch/
  .finally/`instanceof Error`/splice/decorators/BigInt/labeled statements/tagged
  templates/object getters all fail with clear diagnostics; TS annotations/`as`/
  interfaces/type aliases are stripped and TS **enums actually work** (transpileModule
  compiles them to an IIFE the interpreter runs), hence enums deliberately unmentioned.
  `supportedSyntaxMessage` (the in-diagnostic text in `codemode.ts`) is untouched.
- **Workflow/Rules deduped**: the call-by-exact-path, JSON.parse-string-results, and
  return-small content now lives ONLY in the numbered Workflow steps (with their
  compliance-driving justifications inline: "most tools return JSON as a string", "raw
  payloads get truncated and waste context"); Rules keeps only bullets adding new
  content - filter/aggregate collections in code, console.\* intermediates (logs ride
  back), Promise.all parallelism, Object.keys/for...in enumeration, browse-namespace
  (PARTIAL only), and the media rule compressed to one line. The no-.then/.catch
  guidance moved to the Syntax not-supported line. Content upgrades: the PARTIAL search
  step gained query-style guidance (`- short phrases like "list issues" work best`; a
  clearly-a-query-string example, not a tool name), and the exact-path guidance is now
  "call it with the result's `path` as-is (never guess segments)" / COMPLETE: "use it
  as-is rather than guessing segments".
- **Fixed-prose measurements** (instructions split on `"\n## "`, catalog budget 0,
  bytes/3.7 - same method as Fix 4; chars/4 in parentheses):
  preamble 44 -> 44 (41 -> 41), Workflow 146 -> 187 (135 -> 171), Rules 362 -> 191
  (332 -> 176), Syntax 453 -> 188 (419 -> 174); fixed prose total 1,005 -> 610 (927 -> 562),
  ~ 40% reduction with no behavioral content dropped. Workflow grew slightly because it
  absorbed the deduped parse/return-small justifications.
- **Round-robin namespace inlining** (`discoveryPlan`): the ported stop-on-first-miss
  behavior (alphabetically-late namespaces starved to "none shown" while an early
  namespace inlines everything) is replaced by round-robin fairness - in each round
  (namespaces alphabetical), every namespace still holding un-inlined tools attempts to
  place its next-cheapest line against the shared token budget; a namespace whose next
  line does not fit is done while the others keep going; stop when all are done. Every
  namespace gets some representation before any namespace gets everything. Kept:
  `estimate` (chars/4) budget accounting, unbudgeted namespace stub lines, per-namespace
  `(N tools)`/`(N tools, K shown)`/`(N tools, none shown)` labels, COMPLETE vs PARTIAL
  header, alphabetical namespace order in the output, cheapest-first within each
  namespace's shown set.
- **Plural/singular search fix**: `tokenize`d terms matched one-directionally (term must
  be substring of indexed text), so query "issues" missed a tool whose text only says
  "issue". Now each term expands to `termForms` - the term plus naive singular variants
  (trailing "es" stripped when length > 3, trailing "s" when length > 2) - and each of
  the four field checks passes when ANY form matches. Weights, exact-path lookup, and
  namespace scoping untouched. A true plural path match still outranks a singular-only
  description match (path substring 8 + searchable 2 > description 4 + searchable 2).
- **Tests**: package instruction/structure assertions updated to the new text; new
  syntax-section test (leads with "Standard modern JavaScript works", names the
  verified not-supported list, keeps the data-boundary note); the budget-exhaustion
  test rewritten to assert the new fairness (alpha.expensive not fitting must NOT
  prevent beta.cheap from showing: PARTIAL 2 of 3, `- beta (1 tool)` fully shown); new
  plural/singular test (query "issues" finds a singular-only tool; ranking still
  prefers the true "issues" path match). Adapter: description assertions updated; the
  large-catalog PARTIAL test now asserts `zeta_only_tool` IS shown (`- zeta (1 tool)` +
  its inlined line) - it was "none shown" under starvation. README updated (budgeted
  catalog paragraph -> round-robin; search paragraph -> singular variants;
  instructions-structure paragraph -> new section contents). Package suite: 169 pass /
  0 fail; adapter suites: 34 + 16.

**Fix 9 - prompting trims per user review of Fix 8** (user reviewed the condensed
instructions and directed further cuts):

- Default `maxInlineCatalogTokens` 4,000 -> **2,000** (user wants ~2k tokens of signatures
  auto-inlined; round-robin fairness from Fix 8 spreads it across all namespaces).
- Console rule and files/images rule DROPPED from `## Rules`. Replaced by a single
  `unknown`-treatment warning: "A result typed `Promise<unknown>` has no guaranteed
  shape - verify what actually came back before relying on its fields." (Deliberately
  does NOT suggest console.log - user review: naming it there nudges models to log AND
  return the same data; the prompt stays console-neutral, neither for nor against.)
  The media-stripping MECHANISM is unchanged and still tested; only the prose about it
  is gone - the `[N images attached]` marker is self-explanatory in context.
- Kept as-is per user: the JSON.parse workflow step (maps to the original motivating
  transcript failure; NOT copied from prior art - see section 5 note), the browse-namespace rule
  (undecided), no no-fetch/ambient-authority rule added (proposed, not approved).
- Explicitly REJECTED for now: auto-parsing JSON-looking text results at the adapter
  boundary ("could get weird" - type flips, program-sees vs tool-sent divergence). Logged
  as a next-iteration follow-up below.

**DSL-expansion pass - interpreter-surface batch from section 4** (the deferred medium-tier JS
parity items, done as one focused pass; no public API or limit changes):

- **`instanceof` + real Error values**: the `errorConstructors` names (`Error`,
  `TypeError`, `RangeError`, `SyntaxError`, `ReferenceError`, `EvalError`, `URIError`) are
  bound globals (`ErrorConstructorReference`, callable with or without `new`; `typeof` ->
  `"function"`). Error values stay the same plain `{ name, message }` null-prototype
  objects as before - the constructor name additionally rides on a NON-ENUMERABLE symbol
  key (`ErrorBrand`), which every `Object.entries`-based walk (copyIn/copyOut, spread,
  JSON.stringify) is blind to, so serialization is byte-identical to the old shape and the
  brand is lost on spread/boundary copies exactly like JS loses the prototype.
  `caughtErrorValue` produces `{ name, message }` wrappers via `createErrorValue`, so
  caught interpreter AND tool failures are `instanceof Error` and carry the `name` the
  equivalent real-JS failure would have (follow-up fix, user-directed - "closest to real
  JS"): `InterpreterRuntimeError` gained an `errorName` field ("Error" default) set
  fluently at throw sites via `.as(name)` - `JSON.parse` failures are `"SyntaxError"` (and
  now include the engine's position detail in the message; safe - derived from the
  program-supplied string), invalid regex patterns/flags `"SyntaxError"`, unknown
  identifiers and TDZ access `"ReferenceError"`, assignment to a constant `"TypeError"`,
  a bad `normalize` form `"RangeError"`; a host Error reaching the catch path directly
  keeps its own name when it is one of the standard seven. Tool failures and everything
  without a specific analogue stay `"Error"` - internal class names never leak. Specific
  names satisfy the specific `instanceof` (`e instanceof SyntaxError`), matching JS.
  The operator is handled in `evaluateBinaryExpression`
  BEFORE the data-only operand check (like `typeof`, it observes any lhs - promises and
  functions included); recognized rhs: the error constructors (a specific type matches its
  own brand or `Error`, never a sibling), `Date`/`RegExp`/`Map`/`Set` (sandbox classes),
  `Array`, `Object` (any object/function-ish value), `Promise` (`SandboxPromise`), and
  `Number`/`String`/`Boolean` (always false - no boxed values exist); anything else is a
  catchable error naming the recognized constructors.
- **Array methods**: `splice` (mutating, returns the removed elements; insertions run
  `rejectCircularInsertion` like push/unshift; one-arg form removes to the end, undefined
  delete count removes nothing), `fill` (circular-checked value) and `copyWithin`
  (host-delegated), and `keys`/`values`/`entries` returning **arrays** (the Map/Set
  convention - for...of and spread work either way). The `retryableArrayMethods`
  "rewrite using map/filter" hint set emptied out and was deleted with its branch; unknown
  array properties still read `undefined`.
- **String methods**: `localeCompare(that)` (locale/options arguments ignored - host
  default locale; the dominant use is a sort comparator), `normalize(form?)` (invalid form
  -> catchable error naming the four valid forms), `trimLeft`/`trimRight` as
  trimStart/trimEnd aliases.
- **Actionable regex failures**: `toHostRegex` and `constructRegExp` now show the
  offending pattern (or flags) plus the engine reason (deduped "Invalid regular
  expression:" prefix via `regexFailureReason`) and a shared escaping hint
  (`escapeRegexHint`); flags failures list the valid flag letters; the
  replaceAll/matchAll missing-`g` errors spell out the exact `/pattern/g` to write and
  the single-match alternative.
- **copyIn split (the important one)**: `copyIn(value, label, preserveSandboxValues =
false)` - recursion moved to a private `copyBounded`; `boundedData` (every intra-sandbox
  checkpoint: `Object.*` helpers, coercion/Array.from/join inputs, template
  interpolation, expression-result checkpoints) is now `copyIn(value, label, true)`,
  which passes `SandboxDate`/`SandboxRegExp`/`SandboxMap`/`SandboxSet` through **by
  reference as leaves** (contents not walked - Map/Set members are validated at their
  mutation sites) while keeping the depth (`MAX_VALUE_DEPTH`), circularity,
  plain-objects-only, blocked-property, and data-only checks; un-awaited promises keep
  the await-hinting rejection in BOTH modes (deliberate - JS-parity pass-through was
  considered and skipped to preserve the nudge). The HOST boundary (final result,
  tool-call arguments, `JSON.stringify`, tool-result intake) uses the default mode and
  still serializes JSON forms (Date -> ISO, RegExp/Map/Set -> `{}`); host instances met on
  the preserving path are defensively wrapped into sandbox equivalents. Ripple: the
  `Object.*` helpers treat sandbox values as empty objects (`Object.keys(map)` -> `[]`,
  assign sources contribute nothing, hasOwn -> false - JS has no own enumerable props
  there), so interpreter internals (`.map`/`.time`/`.regex`) can never leak; the
  template-literal sandbox carve-out collapsed into `boundedData`. Object/array spread
  already preserved instances (reference copies, no checkpoint) - now tested.
- **Console formatting**: `formatConsoleArgument` is total and deep
  (`formatConsoleValue`): numbers render via `String` (`NaN`/`Infinity`/`-Infinity`
  literally - never the JSON `null`; finite numbers match their JSON form), nested
  strings are JSON-quoted, sandbox values keep their friendly forms at ANY depth (ISO
  date, `/regex/flags`, `Map(n) [...]`, `Set(n) [...]`), opaque references become
  in-place `[CodeMode reference]` markers instead of collapsing the whole argument,
  cycles render `[Circular]` (reachable via Map/Set members, which mutation never
  checkpoints), and depth beyond `MAX_CONSOLE_DEPTH = 32` (fixed constant, not a knob)
  degrades to `...` - console can no longer fail a program. `console.table` guards with
  `containsOpaqueReference` (sandbox cells render, e.g. ISO dates) and its row/cell
  walkers treat sandbox values as scalar cells.
- **Prose**: the instructions Syntax not-supported line dropped its `instanceof
Error`/splice mentions (nothing else reworded); README updated (checkpoint
  preservation vs boundary serialization, error values/`instanceof`, new array/string
  methods, regex-failure behavior); `supportedSyntaxMessage` left untouched (it lists
  supported syntax, was already non-exhaustive, and stays accurate).
- **Tests**: package suite 169 -> 209 (parity: Error/instanceof + real-JS error-name
  coverage, splice/fill/copyWithin/keys/values/entries, localeCompare/normalize/trim-alias
  describes; stdlib: checkpoint survival incl. tool-arg boundary pinning, stdlib
  `instanceof`, regex-message assertions; codemode: NaN/Infinity + nested/cyclic console
  rendering, table cells, caught-tool-failure `instanceof`); adapter suites unchanged
  (34 + 16, green); both packages `tsgo --noEmit` clean.

**Truncation layering - CodeMode truncation off in OpenCode** (user direction; resolves the
section 4 outer-truncation item the OPPOSITE way from "kill the outer one"):

- `maxOutputBytes` lost its 32,000 default and now behaves exactly like the other two
  limits: absent = no truncation. All three limits are uniformly no-default - budgets are
  host policy. `ResolvedExecutionLimits.maxOutputBytes` is `number | undefined`;
  `boundOutput` only runs when the host set the limit. Explicit values validate as before
  (safe integer >= 0).
- OpenCode continues to pass NO limits, which now also means no CodeMode truncation.
  `execute` is a normal `Tool.define` tool, so OpenCode's native tool-output truncation
  applies with no special-casing - verified by tracing `wrap()` (`tool.ts:130-144`,
  50KB/2000-line thresholds in `truncate.ts`, full output dumped to a file under
  `tool-output/`): the `metadata.truncated` self-truncation exemption never fires for
  `execute` (its metadata never sets that key). One truncation layer, the host's - and it
  is the richer one (file dump + explore/grep hint vs an inline marker).
- Hosts without their own output bounding set `maxOutputBytes` explicitly; README table
  and prose updated, adapter comment rewritten. Tests: codemode +1 (absent limit -> 100KB
  value + 50KB log line pass through unbounded, `truncated` undefined); the adapter test
  that relied on the old default now asserts the oversized result reaches the shared
  wrapper un-truncated. Suites: 210 + 50, tsgo clean both.

**Docs polish** (post-API-review): stale `DiscoveryOptions` JSDoc fixed (claimed default
4,000 and alphabetical cheapest-first - now 2,000 and round-robin, matching Fix 8/9 reality)
and the README's incorrect "`effect` as a peer dependency" line corrected (`effect` is a
regular dependency; hosts depend on it themselves because the API surface is Effect-typed).

**Registry promotion + permission-aware catalog** (the "promote to a proper tool service"
restructure; fixes the section 4 permission-advertising bug):

- **The adapter moved** `src/session/code-mode.ts` -> `src/tool/code-mode.ts` and is now a
  registry-resident tool service on the TaskTool precedent: `CodeModeTool =
Tool.define(CODE_MODE_TOOL, ...)` whose init depends on `MCP.Service`, `Agent.Service`,
  and `Session.Service`. It is yielded in `ToolRegistry.layer`, gated into `builtin` by
  `flags.experimentalCodeMode` (like the lsp/plan experiments), and `MCP.node` joined the
  registry's `node.deps` (`MCP.node` has no ToolRegistry dependency, so no cycle). The
  session-level special-casing in `session/tools.ts` (ad-hoc `SessionCodeMode.define` +
  append) is deleted; the early return that suppresses raw per-MCP registration when the
  flag is on stays session-side, keyed on the same flag+tool-count condition.
- **Enablement** lives in `ToolRegistry.tools()` next to the WebSearchTool check: the MCP
  tool count is consulted once (an Effect) before the synchronous filter, and code mode
  passes the predicate iff `flags.experimentalCodeMode` && count > 0.
- **Description split on the `describeTask` precedent**: the tool's static base
  description is a two-line summary; `describeCodeMode(agent)` in `registry.tools()`
  appends the full CodeMode instructions (workflow/rules/syntax + grouped catalog,
  `catalogInstructions` in the adapter) at the same composition point as task - so
  `plugin.trigger("tool.definition")` sees the base description first.
- **Permission-aware catalog + dispatch** (the bug fix): the visibility predicate from
  `llm/request.ts` `resolveTools` is hoisted to `Permission.visibleTools(tools, ruleset)`
  (a record filter over `Permission.disabled` - only a hard `deny` with pattern `"*"`
  hides a tool; ask-level rules stay fully visible and prompt at call time) and
  `resolveTools` now uses it, so the two paths cannot drift. `describeCodeMode` filters
  with the merged agent+session ruleset that `SessionTools.resolve` passes into the
  registry before building the catalog/search index; `execute` rebuilds the runtime per
  execution from a fresh, filtered `mcp.tools()` snapshot using the same merged ruleset
  (`Agent.get(ctx.agent)` + `Session.get(ctx.sessionID)`, matching the merge
  `SessionTools.context` wires into `ctx.ask`) - a denied tool is not dispatchable
  even if the model guesses its name and yields the normal unknown-tool diagnostic.
  Documented gap (out of scope by design): per-message `user.tools[key] === false` arrives
  at request-prep after descriptions are built and has no child-call equivalent.
- **Preserved behavior**: cancellation race + pre-aborted-signal guard, `toSandboxResult`
  unwrap order, attachment accumulation, `CODE_MODE_TOOL` at all title sites, no execution
  limits (native truncation only), `displayInput`, per-child `ctx.ask` gating (now wired
  through `Tool.Context` exactly like every registry tool).
- **Explicit non-goal**: memoizing the catalog builder keyed on (ToolsChanged generation,
  permission ruleset) was considered and deliberately skipped - the per-turn rebuild is
  cheap (grouping + string rendering); revisit only if profiling shows it matters.
- **Tests**: the two adapter suites moved to `test/tool/{code-mode,code-mode-integration}
.test.ts` (mocked `MCP.Service`/`Agent.Service`/`Session.Service` replacing the direct
  `define(...)` construction; description assertions target `catalogInstructions`, the
  registry's composition input) and gained permission coverage: deny excluded from
  catalog/search, ask-level stays visible and callable, denied tool undispatchable
  (unknown-tool diagnostic), `Permission.visibleTools` semantics. `test/tool/
registry.test.ts` gained four registry-level tests: registered with flag+MCP tools,
  excluded without MCP tools, excluded with flag off, and deny/ask catalog filtering
  through `registry.tools()`. Suites: 43 + 16 adapter tests, 16 registry tests, all green.

**Shared MCP invocation middle (`McpInvoke.invoke`)** (closes the section 4 "plugin hooks skip
child calls" gap):

- `packages/opencode/src/mcp/invoke.ts` extracts the duplicated "invoke an MCP tool"
  middle into one shared `McpInvoke.invoke(input)`: plugin `tool.execute.before` hook ->
  permission ask (`{ permission: key, patterns: ["*"], always: ["*"] }` via the caller's
  `ctx.ask`) -> dispatch through the ai-sdk tool's execute inside the `Tool.execute`
  tracing span (`tool.name`/`tool.call_id`/`session.id`/`message.id` attributes) ->
  plugin `tool.execute.after` hook. It returns the RAW result the ai-sdk execute
  resolved with; each caller keeps its own shaping edge - the legacy per-MCP loop in
  `SessionTools.resolve` applies its existing model-facing shaping/truncation, code
  mode applies `toSandboxResult`. It lives under `src/mcp/` because both callers
  already depend on MCP and the function is about invoking an MCP-backed ai-sdk tool,
  not about sessions or code mode.
- **After-hook payload**: fired inside `McpInvoke.invoke` with the raw MCP result -
  which is exactly what the legacy loop always passed (the raw `CallToolResult`, not
  the shaped `{title, output, metadata}`), so legacy behavior is preserved bit-for-bit
  and the hook payload cannot drift between callers. No callback/edge-firing design
  was needed.
- **Synthetic child callID**: code-mode child calls pass `${parentCallID}/${n}` as the
  hook/span callID (`parentCallID` = the `execute` call's `ctx.callID`, falling back to
  the entry key; `n` = per-execution counter starting at 1, shared across all child
  calls in one program). callID is an opaque string - nothing parses it. The ai-sdk
  `toolCallId` (`options.toolCallId`) stays each caller's existing value
  (`ctx.callID ?? entry.key` for code mode).
- **Child-scoped hook failures**: `CodeModeTool` (which now also yields
  `Plugin.Service`) wraps the whole child call - hooks, ask, dispatch - in
  `toCatchable` (the generalization of the old `askPermission` catchCause), so a plugin
  hook failure fails ONLY that child call as a catchable in-program `toolError`; other
  calls in the same program keep running and interruption still propagates as
  interruption. Legacy semantics unchanged: a hook failure fails the tool call.
- **Tests**: `test/tool/code-mode.test.ts` +2 (child calls fire before/after with the
  MCP key and `parent/1`, `parent/2` ids, after hook carries the raw MCP result; a
  failing before hook is caught in-program, gates dispatch, and leaves the outer
  execute ok) - both code-mode harnesses gained a `Plugin.Service` mock (pass-through
  trigger by default, overridable). New `test/session/tools.test.ts` (3 tests) pins
  `SessionTools.resolve` at the real-registry seam (LayerNode.compile, fake MCP layer):
  flag on + MCP tools -> `execute` present, raw MCP keys suppressed; flag off -> raw
  keys present, `execute` absent; and the legacy raw-MCP execute fires before/after
  hooks keyed by the ai-sdk toolCallId with the raw result payload. Suites: adapter
  45 + 16, session/tool/permission all green; this package untouched (211 pass).

**Signature rendering + compound-assignment parity fixes** (externally reported, both
verified real with failing tests before fixing):

- **Non-identifier property names in rendered signatures** (`src/tool.ts`): `renderSchema`
  emitted raw property names, so schema properties like `foo-bar`/`@type`/`x.y`/`123`
  rendered invalid TypeScript (`{ foo-bar?: string }`). Fixed with a `renderKey` helper -
  bare identifiers stay bare, everything else is `JSON.stringify`-quoted - applied in the
  single `field` closure both the compact and pretty renderings share. The
  `identifierSegment` regex now lives in `tool.ts` (exported) and `tool-runtime.ts`'s
  bracket-notation `toolExpression` imports it: one source of truth for "is this a bare
  identifier" across object keys and tool paths. Tests: `signature.test.ts` +4 (compact,
  pretty with JSDoc on a quoted key, JSON Schema input+output, Effect Schema struct).
- **Numeric schema unions keep their real alternatives** (`src/tool.ts`): the old
  `anyOf`/`oneOf` renderer collapsed any union containing `{ type: "number" }` to just
  `number`, dropping real JSON Schema alternatives (`string | number`, `number | null`,
  etc.). The collapse is now restricted to Effect's number-schema artifact
  (`number | "NaN" | "Infinity" | "-Infinity"`, emitted as single-value string enums),
  while raw JSON Schema unions render every branch. Tests: `signature.test.ts` +3.
- **Compound assignment now matches binary-operator semantics** (`src/codemode.ts`):
  `applyCompoundAssignment` did raw JS ops on interpreter wrapper objects, so `x += y`
  diverged from `x = x + y` (sandbox Date `d += 1` produced `"[object Object]1"`;
  `d -= 400` gave `NaN` instead of epoch arithmetic). The operator table + coercion moved
  verbatim out of `evaluateBinaryExpression` into a shared `applyBinaryOperator`;
  compound assignment validates against a `compoundOperators` set (`+=` ... `>>>=`) and
  dispatches through it (`operator.slice(0, -1)`). Logical assignments (`&&=`/`||=`/`??=`)
  keep their separate short-circuit path (`evaluateLogicalAssignment`), and both
  assignment call sites still wrap results in `boundedData`. Deliberate side effect:
  compound assignment now rejects opaque references, consistent with binary operators.
  Tests: `parity.test.ts` +5 (Date `+=` concat parity, Date `-=`/`/=` epoch parity,
  string `+=` object/array, member-target compound, 13-case operator sweep vs real JS).
  Package suite: 220 pass.

---

## 4. Remaining work (detailed TODO)

### Next DSL-expansion pass (done - see the DSL-expansion pass entry in section 3)

Batch these together - per user direction: important, but deliberately deferred to one
focused interpreter-surface pass rather than picked off piecemeal.

- [x] Medium-tier JS parity items deferred from the original audit: caught errors are plain
      `{ name, message }` objects, not `instanceof Error` (and `Error` isn't a value -
      `x instanceof Error` is unsupported syntax); `splice` (still a
      "rewrite using map/filter" hint) and array `entries()/keys()/values()`;
      `localeCompare`/`normalize`/`trimLeft`/`trimRight`; friendlier regex-y error messages.
      (`fill`/`copyWithin` - which the hint set also covered - were implemented too since
      they are trivial host delegations, so the hint set is gone entirely.)
- [x] `Date`/`Map`/`Set`/`RegExp` values passing through `Object.*` helpers and coercion
      checkpoints take their JSON forms (e.g. `Object.values({ d: date })` yields the ISO
      string, not the Date - calling `.getTime()` on it then fails). Currently deliberate
      (documented in README) but flagged as important: fix in this pass by letting sandbox
      values survive `Object.*`/spread checkpoints instead of JSON-serializing them.
- [x] `console.log(NaN)` prints `"null"` (goes through the boundary chokepoint) - could
      special-case number formatting in `formatConsoleArgument`.
- [x] Sandbox values nested inside logged containers print `[CodeMode reference]`
      (`console.log({ m: map })`) - could deep-format instead.

### Next iteration: text-result handling (deliberate follow-up, user-directed)

- [ ] Revisit how MCP text results reach the program. Today: `structuredContent` when the
      server sends it, else joined text as a plain string (the program JSON.parses it,
      guided by a workflow step). Considered and deferred: (a) conservative boundary
      auto-parse (text starting with `{`/`[` that parses cleanly becomes an object) -
      rejected for now as potentially confusing (type flips; program sees something other
      than what the tool sent); (b) raw-envelope passthrough with the envelope shape
      stamped into every output schema - rejected (more digging per call, verbose
      signatures). Result quality is dominated by whether servers declare output schemas;
      revisit once real usage shows which failure modes matter.

### Next iteration: stdlib surface (prioritized)

Current instructions say "usual Array/String/Object/Math/JSON methods," but the interpreter is
intentionally a subset. Keep CodeMode focused on orchestration and data shaping, not a full host
runtime, but close the high-friction gaps models are likely to reach for.

- [ ] **P0: tighten wording first** - change instructions/docs to say "common stdlib subset"
      until the surface is broader. This avoids misleading the model into assuming every JS
      helper exists.
- [ ] **P1: URL parsing helpers** - add `URL` and `URLSearchParams`. These are high-value for
      tool orchestration (query strings, ids in URLs, API links), deterministic, and do not add
      ambient host authority.
- [ ] **P2: Math completion** - add the missing standard deterministic `Math` methods
      (`sin`/`cos`/`tan`, inverse/hyperbolic variants, `atan2`, `log1p`, `expm1`, `imul`,
      `fround`, `clz32`, etc.). Decide explicitly on `Math.random`: likely acceptable because
      `Date.now()` is already exposed, but document the nondeterminism if enabled.
- [ ] **P3: base64 helpers** - add string-only `atob`/`btoa` equivalents. Useful for API/tool
      payload cleanup and does not require opening the broader binary boundary.
- [ ] **P4: small crypto helper** - consider `crypto.randomUUID()` only, not full `crypto`.
      UUID generation is a common orchestration need; broader crypto can wait until there is a
      concrete use case and a clear capability boundary.
- [ ] **P5: text/binary primitives** - consider `TextEncoder`/`TextDecoder` first, then
      `ArrayBuffer`/typed arrays/`DataView`/`Blob`/`File` only with an explicit boundary design
      (serialization, size limits, and how values cross tool args/results). This is reasonable
      but lower priority than URL/base64 because CodeMode is still plain-data oriented.
- [ ] **P6: date/formatting conveniences** - consider `Date` setters and common formatting
      helpers (`toUTCString`, maybe `Intl` later). Lower priority; most orchestration can use
      existing getters, `Date.parse`, `Date.UTC`, and ISO strings.
- [ ] **P7: environment/config access** - do not expose raw `process.env` as a global ambient
      authority. If this becomes useful, add an explicit host-provided/whitelisted capability
      (for example a small env/config tool or injected read-only object) so secrets are not
      accidentally exposed to arbitrary CodeMode programs.

Explicit non-goals for now: `structuredClone`, `WeakMap`/`WeakSet`, and timers
(`setTimeout`/`setInterval`/`queueMicrotask`). They do not materially improve the current tool
orchestration use case.

### Wiring-review findings (subagent code review of the OpenCode integration, triaged)

Pre-PR fixes (user-approved cut):

- [x] **Cancellation does not interrupt the interpreter** - the no-limits rationale claimed
      "user cancel interrupts the execution fiber," but `tools.ts` runs tools via
      `run.promise` -> `Effect.runPromise` (`effect/bridge.ts:64-66`) with NO abort wiring;
      on cancel the ai-sdk abandons the promise, child MCP calls abort (they hold
      `ctx.abort`) but the interpreter fiber spun on - `while(true){}` or a try/catch
      loop was uncancellable with no timeout backstop. Verified by hand, not just the
      reviewer. FIXED in the adapter: `Effect.raceFirst(runtime.execute(code), cancelled)`
      where `cancelled` is an `Effect.callback` abort-signal watcher (listener removed on
      interruption) resuming with an `ok: false` "Execution cancelled." result - the abort
      winning the race interrupts the execution fiber (interpreter auto-yield makes busy
      loops preemptible, same mechanism as timeoutMs) and returning a value keeps the
      runner's post-abort `completeToolCall` bookkeeping on its normal path. A pre-aborted
      signal short-circuits at entry before the program starts (racing alone still lets
      the loser run its first steps). Tests: +2 adapter (child call triggers abort
      deterministically then the program enters `while(true){}` - would hang if
      interruption broke; pre-aborted signal runs nothing). Adapter suite 34 -> 36.
      (Wiring abort->interrupt into the shared `tools.ts` runner for ALL tools remains a
      worthwhile separate change.)
- [x] **Permission-denied/disabled MCP tools are still advertised in the catalog** - the
      non-code-mode path filters them from the model's view (`llm/request.ts:208-213`);
      code mode builds the catalog from all of `mcp.tools()`, so the model is invited to
      call tools that can only fail at permission time, and per-message `tools[key]=false`
      disabling has no child-call equivalent. Fix: filter the catalog with the same
      ruleset.
      DONE (see the "Registry promotion + permission-aware catalog" entry in section 3): the
      shared `Permission.visibleTools` predicate filters both the appended
      catalog/description (`describeCodeMode`, agent ruleset) and the execute-time tool
      tree (merged agent+session ruleset) - hard-denied tools are neither advertised nor
      dispatchable. Ask-level tools stay visible/callable. Per-message
      `tools[key] === false` remains a documented gap by design (it arrives at
      request-prep, after descriptions are built).
- [x] Style: `code-mode.ts` is the only `src/session` sibling without the
      `export * as ... from "./..."` self-reexport footer, forcing a star import at
      `tools.ts:26` (AGENTS.md violation). Add footer + import the projection.
      DONE: added `export * as SessionCodeMode from "./code-mode"` footer; `tools.ts` now
      imports the named `SessionCodeMode` projection.
- [x] Trivial: latent `groupByServer` fallback bug - `key.slice(0, key.indexOf("_"))` is
      `slice(0, -1)` when no underscore (unreachable today; guard or drop); dead
      `CODE_MODE_TOOL` export (integration points hardcode `"execute"` - use it or inline
      it).
      DONE: no-underscore key now falls back to the whole key (test pins it); the four
      `title: "execute"` sites in `code-mode.ts` now reference `CODE_MODE_TOOL`.

Post-MVP (logged, not blocking an experimental flag):

- [x] **Plugin `tool.execute.before/after` hooks skip child calls** - legacy MCP
      registration fires them per tool (`tools.ts:419-441`); under code mode only the
      outer `execute` fires them, so auditing/intercepting plugins silently lose MCP
      coverage when the flag flips.
      DONE (see the "Shared MCP invocation middle" entry in section 3): both paths now run
      `McpInvoke.invoke` (`src/mcp/invoke.ts`) - hooks AND the `Tool.execute` span fire
      for child calls with synthetic `${parentCallID}/${n}` callIDs; hook failures are
      child-scoped, catchable in-program errors.
- [x] Description/preview rebuilt every assistant turn - `registry.tools()` re-runs
      `groupByServer` + a throwaway `CodeMode.make(...).instructions()` per turn
      (`describeCodeMode`). DECIDED as an explicit non-goal: memoizing the catalog
      builder keyed on (ToolsChanged generation, permission ruleset) was considered and
      deliberately skipped - the per-turn rebuild is cheap (grouping + string
      rendering); revisit only if profiling shows it matters. A second `CodeMode.make`
      per execution is inherent (description precedes execution).
- [ ] Child permission rejection round-trips through the defect channel - `ctx.ask`
      defect (`tools.ts:90` orDie) recovered via `catchCause` + `Cause.squash`
      (`code-mode.ts:238-245`). Works, interrupts preserved, but fragile coupling;
      exposing the typed rejection on `Tool.Context.ask` would be cleaner.
- [ ] No collision guard on the `execute` tool id (a plugin/custom tool named `execute`
      is silently shadowed; a log line would do).
- [ ] Style nits: triple-nested `yield*` in `tools.ts:101-107` argument position (bind
      first, like neighbors); single-use micro-helpers (`toJsonSchema` is a bare cast);
      comment density far above session-neighbor norm; adapter tests use raw
      `Effect.runPromise` + hand-built layers with `as any` instead of the
      `testEffect`/`LayerNode.compile` fixture pattern (`test/tool/grep.test.ts:25-31`)
      and star-import `Truncate`.
- [ ] Reviewer observation worth keeping: MCP server instructions (`sys.mcp`,
      `session/system.ts:110-126`) still inject prose referencing server-native tool
      names that are no longer directly callable under code mode.

### Backlog / loose ends (non-blocking, any order)

- [ ] `evaluateUpdateExpression` (`++`/`--`) still uses raw `Number(current)`, so `d++` on a
      sandbox Date yields `NaN` where `d += 1` now uses epoch semantics (and real JS `d++`
      would give epoch+0 numeric). Pre-existing, out of scope of the compound-assignment
      parity fix; route it through `applyBinaryOperator` if it ever matters.
- [ ] Media-only marker could name what it attached when MCP provides names: `image`/`audio`
      blocks carry no filename (mime + data only) so the generic
      `[N images attached to the result]` stays, but `resource`/`resource_link` blocks have
      URIs/names we could surface, e.g. `[2 files attached: chart.png, data.csv]`. Minor.
- [x] Truncation layering decided (user direction): the OPPOSITE of killing the outer layer -
      CodeMode truncation off in OpenCode (`maxOutputBytes` lost its default; absent = no
      truncation, uniform with the other two limits), native tool-output truncation is the
      single active layer (verified: `execute` flows through `tool.ts` `wrap()` like any
      normal tool, no exemption). See the section 3 entry.
- [x] Flaky wall-clock assertion removed from `test/promise.test.ts`: the parallelism test
      now relies solely on the deterministic `trace.maxActive > 1` counter (which proves
      true temporal overlap). The timeout tests were never flaky - 100ms timeout vs 60s
      tool sleeps (600x margin) with counter-based assertions.
- [ ] Attachment propagation believed correct but unverified end-to-end at the OpenCode
      wiring layer (codemode strips -> `Tool.ExecuteResult.attachments` -> processor
      normalizes -> `FilePart`s visible to the model). Code-reviewed as sound; confirm with
      one interactive session (an image-returning MCP tool) when convenient. Same session
      can eyeball TUI child-call rendering via `metadata.toolCalls`.
- [x] Commit hygiene: all work committed and pushed on `codemode-v2` as six commits, in
      generic-package + OpenCode-integration pairs (waves 0-5; Fixes 4-9; DSL pass +
      error names + truncation layering). Future work: commit only when explicitly asked;
      push with `--no-verify` per repo convention. The scratch `.opencode/opencode.jsonc`
      stays uncommitted.
- [ ] MVP scope decided (user direction): the interactive e2e eyeball is NOT required -
      remaining pre-PR work is essentially just opening the PR. Attachment-propagation
      verification (below) stays parked as post-MVP.

---

## 5. Context and gotchas for whoever picks this up

- **Motivating failure (why forgiving semantics + prompting matter):** in a real transcript,
  the model wrote `me.result?.login ?? me.result` where the tool result was a JSON _string_ -
  the old strict interpreter threw (`String property 'login' is not available`); then the
  model returned a raw 105KB payload, which native truncation dumped to a file, costing a
  subagent round-trip to extract one number. Interpreter forgiveness stops the crashes;
  Wave 4 prompting stops the payload dumping. Both are needed.
- Realistically **all MCP tools render `Promise<unknown>`** (no outputSchema), so the
  instructions prose is the only lever for result-shape behavior in the dominant case.
- **`copyIn` has two roles, split by a mode flag** (DSL-expansion pass): host<->sandbox
  boundary (default mode - final result, tool arguments, `JSON.stringify`, tool-result
  intake; sandbox value types serialize to JSON forms) AND intra-sandbox data checkpoint
  (`boundedData` = `copyIn(value, label, true)` - sandbox value instances pass through by
  reference as leaves, everything else keeps the same plain-data validation). If you add a
  new value type, follow the Wave 1b-i pattern: class in `values.ts`, opaque-by-default via
  `isRuntimeReference`, explicit carve-outs, JSON form in `copyIn`'s boundary mode plus
  pass-through in its preserving mode, console formatting (`formatConsoleValue`), tests -
  and make sure the `Object.*` helpers treat it as an empty object so class fields never
  leak.
- The interpreter throws synchronously inside `Effect.gen`/`Effect.sync` freely; everything is
  normalized by `catchCause` -> `normalizeError` into `Diagnostic` data. Program failures are
  **data, never Effect failures**; only interruption propagates.
- `parseProgram` wraps source in `async function __codemode__() { ... }`, transpiles TS, then
  slices between the first `{` and last `}` - line/col diagnostics are offset accordingly
  (`sourceLocation`). Don't inject prologue code; it breaks the offsets.
- OpenCode wraps every tool's output with auto-truncation (`Tool.define` wrapper,
  `truncate.output`, 2000 lines / 50KB, saves full output to disk and appends a hint) unless
  `metadata.truncated` is set. The `execute` tool currently rides that for free.
- Effect version: both repos pin `effect@4.0.0-beta.83` via bun catalogs. This package uses
  v4-only APIs (`Schema.Decoder`, `Schema.toJsonSchemaDocument`, `Context.Service`,
  `Cause.hasInterruptsOnly`, `Effect.timeoutOrElse`). The effect-smol checkout referenced in
  the workspace is the implementation source of truth for v4 behavior questions.
- File map (this package): `src/codemode.ts` - types/limits/parser/Interpreter/execute/make;
  `src/tool-runtime.ts` - tool tree, `copyIn`/`copyOut`, search/discovery, invoke path;
  `src/tool.ts` - `Tool.make` + JSON-Schema->TS rendering; `src/values.ts` - sandbox value
  types; `src/tool-error.ts` - `ToolError`; tests in `test/{codemode,parity,stdlib}.test.ts`.
- OpenCode file map (integration points): `src/tool/code-mode.ts` (the adapter, now a
  registry tool service - `CodeModeTool` + `catalogInstructions`; formerly
  `src/session/code-mode.ts`); `src/tool/registry.ts` (`describeCodeMode`, enablement in
  `tools()`, `MCP.node` dep); `src/session/tools.ts` (raw-MCP-registration suppression
  when the flag is on); `src/permission/index.ts` (`Permission.visibleTools`, the shared
  visibility predicate, also used by `src/session/llm/request.ts` `resolveTools`);
  `src/mcp/index.ts` (`MCP.tools()`/`MCP.defs()`); `src/mcp/catalog.ts` (`convertTool`,
  `server_tool` naming); `src/tool/tool.ts` (`ExecuteResult.attachments`, truncation
  wrapper); `src/session/message-v2.ts` (attachments -> vision);
  `packages/tui/src/routes/session/index.tsx` (`Execute` progress component);
  `src/effect/runtime-flags.ts` (feature flag).
