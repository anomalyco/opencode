# CodeMode — Status, Decisions, and Remaining Work

This document is the working plan for `@opencode-ai/codemode` and its OpenCode integration.
It captures every locked decision, everything already implemented, and a detailed TODO of what
remains — enough context that someone (human or agent) can pick up any item cold.

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

- **`packages/codemode` (`@opencode-ai/codemode`)** — the generic, host-agnostic runtime:
  a hand-rolled, Effect-native, tree-walking interpreter over acorn ASTs (TypeScript stripped
  via `typescript`'s `transpileModule`), the tool runtime/data boundary, discovery/search, and
  `Tool.make`. It knows nothing about OpenCode, MCP, permissions, or rendering.
- **`packages/opencode`** — the OpenCode integration: an MCP adapter that converts MCP tool
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
  reserved discovery namespace. (Historical names — "rune", "capability" — are dead.)
- Existing OpenCode core tools (bash/edit/patch/...) stay registered normally for v1.
  CodeMode covers MCP tools, user-registered tools, and deferred tools only.
- Test runner is `bun test`; typecheck is `tsgo --noEmit` (repo conventions). Not vitest.
- **Never reference external prior-art implementations** (other companies' code-execution
  products/blog posts) in code, comments, commit messages, or docs in this repo.

### MCP / tools
- The MCP adapter lives in OpenCode, not here. It converts MCP definitions into ordinary
  `Tool.make(...)` definitions and hands CodeMode a plain tool tree.
- Permissions stay in the OpenCode adapter (each tool's `run` wraps the permission ask).
  CodeMode stays dumb — no permission model in this package.
- Namespace collisions: last write wins (plain JS object override). No `tools.mcp.*` prefix,
  no `_2` suffixing, no cleverness. OpenCode groups flat `server_tool` MCP names into
  `tools.<server>.<tool>` namespaces before handing them over.

### Discovery / search
- **Search only — no separate `describe`.** `tools.$codemode.search({ query?, namespace?,
  limit? })` over the final tool tree, owned by this package.
- Search result item shape: `{ path, description, signature }`. The `signature` string embeds
  the full input/output TypeScript types, so separate `input`/`output` fields were dropped as
  redundant (the issue listed them; we resolved the redundancy in favor of signature-only).
  Result `path`s carry the `tools.` prefix (post-wave fix) so each is directly usable as the
  call site; the internal `ToolDescription.path` stays unprefixed.
- Default limit: **10** (done). Exact-path lookup goes through search too: a query equal to a
  tool path (with or without the `tools.` prefix) returns that tool alone (done).
- Signatures render **native payloads**: `Promise<Issue>`, NOT `Promise<Result<Issue>>`.
  There is no result envelope; attachments never appear in return types (they are collected
  host-side, see below).
- Tools without an output schema render `unknown` as their return type.

### Schemas / Tool.make
- `Tool.make` carries rich metadata so search can render real signatures.
- Support **Effect Schema** (first-class, validating) and **JSON Schema** (initially
  render-only — used for TypeScript rendering; the adapter may validate on its own). Leave
  room for Standard Schema later.
- Tool implementations are **Effect-based** for v1 (`run` returns `Effect`). Promise
  normalization for plugin authors can come later.

### Attachments / output
- **No `output.text/file/image` API in v1.** (Deleted in Wave 2.)
- Tool calls return native structured payloads into the sandbox. Files/images emitted by
  child tools **never enter the sandbox** — the OpenCode adapter strips and accumulates them
  host-side as calls happen, then returns them on the outer `execute` tool result as ordinary
  tool-result attachments (OpenCode already has `Tool.ExecuteResult.attachments` → vision
  plumbing in `message-v2.ts`).
- No base64 in CodeMode values, ever. The model routes nothing; it can't accidentally dump
  image bytes into context or drop attachments.

### Runtime behavior
- Public limits are simple: `{ timeoutMs, maxToolCalls, maxOutputBytes }`. The other knobs
  (maxOperations, maxDataBytes, maxValueDepth, maxCollectionLength, maxSourceBytes,
  maxAuditBytes, maxConcurrency) are internal constants, still reachable for tests via the
  `@internal` `InternalExecutionLimits` type (exported from `codemode.ts`, not from the package
  index). (Done in Wave 2.)
- CodeMode owns truncation of its own returned output (`maxOutputBytes`). OpenCode's native
  tool-output truncation (50KB / 2000 lines in `tool.ts` + `truncate.ts`) stays on as the
  outer safety net for now; we may remove that layering later.
- Pure-JS built-ins only. **No ambient authority**: no fs, child processes, network/fetch,
  process/env, or timers in v1. The agent has the bash tool for that.
- Forgiving JS semantics are locked (see §3, Wave 1a/1b-i) — missing props read `undefined`,
  `typeof` never throws, NaN/Infinity flow in-sandbox, etc.
- `console.*` is captured into `logs` on the result; the host appends them to model-facing
  output. Not a tool call; costs no tool budget.
- Simple tool-call **start/end hooks** for nested progress: `onToolCallStart({ index, name,
  input })` and `onToolCallEnd({ index, name, input, durationMs, outcome, message? })`.
  Interrupted calls fire no end event. No `CurrentToolCall` context service (removed in
  Wave 2).

---

## 3. Current status (what is already done on `codemode-v2`)

Waves 0–5 and the post-wave fixes below are committed on `codemode-v2` (two commits: the
generic package, then the OpenCode integration). Verification: from
`packages/codemode`, `bun test` (156 pass / 0 fail across
`codemode/parity/stdlib/promise/enumeration`) and `bun run typecheck`; from
`packages/opencode`, `bun run typecheck` and `bun test test/session/` (all green — the
adapter suites are `code-mode.test.ts`, 35 tests, and `code-mode-integration.test.ts`,
16 tests).

### Wave 0 — scaffold (done)
- `packages/codemode` created from the experiments implementation: `src/{index,codemode,tool,
  tool-error,tool-runtime}.ts`, README, AGENTS.md, tests.
- `package.json`: name `@opencode-ai/codemode`, deps `acorn@8.15.0`, `typescript: catalog:`,
  `effect: catalog:` (both repos pin effect `4.0.0-beta.83`; opencode's effect patch only
  touches `unstable/httpapi`, which this package doesn't use).
- Tests converted vitest → `bun:test`. Only src change from verbatim: the `CurrentToolCall`
  Context.Service key string renamed to `@opencode-ai/codemode/CurrentToolCall`.

### Wave 1a — forgiving JS semantics (done)
Ported from the old opencode rune work; `test/parity.test.ts` (24 tests) is the acceptance
spec. The seeded interpreter was deliberately strict; these behaviors replaced that:

- **H1**: NaN/Infinity flow as in-sandbox values (`copyIn` admits them; `NaN`/`Infinity` are
  bindable globals; `charCodeAt` returns real NaN). Normalized to `null` only at the data
  boundary (`copyOut` — single chokepoint for final results AND tool-call arguments), matching
  `JSON.stringify`. Guards like `Number.isNaN(x)` / `parseInt(x) || 0` work.
- **H2/H3**: unknown property reads on strings/numbers/arrays → `undefined` (incl. under
  `?.`), instead of throwing. This was the real-transcript failure: models write
  `result?.login ?? result` against JSON-string tool results.
- **H4**: `typeof undeclaredIdentifier` → `"undefined"` (short-circuits before resolution).
- **H5**: `Boolean`/`String`/`Number` accepted as array callbacks (`filter(Boolean)`).
- **H6**: `{...null}` / `{...undefined}` object spread is a no-op. Array spread of
  null/undefined still throws (real JS throws too).

### Wave 1b-i — stdlib value types: Date, RegExp, Map, Set (done)
`src/values.ts` holds `SandboxDate/SandboxRegExp/SandboxMap/SandboxSet` (own module so both
`codemode.ts` and `tool-runtime.ts` import without a cycle). Design:

- Opaque-by-default: all four join `isRuntimeReference`, with explicit carve-outs (member
  access allowlists, Date in binary/unary ops, Map/Set in spread/for...of, console formatting,
  byte accounting in `runtimeValueBytes`, `containsOpaqueReference` for operator guards).
- **JSON semantics at every boundary and checkpoint**: Date → ISO string (invalid → null),
  RegExp/Map/Set → `{}`. `copyIn` also converts host `Date`/`RegExp`/`Map`/`Set` instances the
  same way (a host tool may legitimately return them).
- Date: `Date.now/parse/UTC`, `new Date(epoch|string|components)`, getters + UTC variants,
  `end - start`, `a < b`, `+date`; `toString` is ISO for cross-host determinism.
- RegExp: literals + `new RegExp`, `test`/`exec` (stateful `lastIndex` for `g`), string
  `match/matchAll/replace/replaceAll/split/search`. Match results are plain arrays carrying
  `index`/named `groups` as own properties (enabled by a general array own-property read fix);
  `input` omitted deliberately. Function replacers unsupported (clear error). Patterns run on
  the host engine — catastrophic backtracking is bounded only by `timeoutMs` (accepted, in
  README).
- Map/Set: full method sets; `keys/values/entries` return **arrays** (not iterators);
  `for...of` + spread work; `Object.fromEntries(map)`, `Array.from(map|set)`; SameValueZero
  keys (NaN findable); mutations maintain incremental byte totals and enforce
  `maxCollectionLength`/`maxDataBytes`.
- Rode along, same spirit: `typeof` never throws for any value (`typeof fn` → `"function"`),
  `!` works on any value, `for...of` over strings, `{...sandboxValue}` no-op, template
  interpolation renders `/regex/` and ISO dates directly.

### Wave 2 — API layer (done)
The package's public contract, reshaped for the Wave 3 adapter. 101 tests / 0 fail after this
wave; both packages typecheck clean.

- **`Tool.make` schema flexibility** (`src/tool.ts`): `input`/`output` each accept an Effect
  Schema (validating, decoded both directions as before) OR a raw JSON Schema document
  (render-only — no validation, values pass through; rendering handles `$defs`/`definitions`
  + `$ref`). `output` is **optional** → signature renders `Promise<unknown>` and the host
  result is exposed as-is. Discrimination via `Schema.isSchema`. New helpers exported from
  `tool.ts`: `inputTypeScript`/`outputTypeScript`/`decodeInput`/`decodeOutput`/
  `jsonSchemaToTypeScript`; `tool-runtime.ts` consumes them (no direct `Schema.*` use there
  anymore). Types `JsonSchema`/`ToolSchema` exported from the index. Note: an empty
  `Schema.Struct({})` renders as `{  } | Array<unknown>` (effect's JSON Schema emission) —
  cosmetic, fixed in Wave 4.
- **`output.*` API deleted**: `OutputItem`(+Schema), result `output` fields, the `output`
  global/namespace dispatch, `invokeOutput`/`outputItem`/helpers, interpreter output fields,
  instructions line, README section, seeded tests. AGENTS.md keeps a rephrased
  future-design note (channel name stays `output` if it ever returns).
- **Hooks**: `CurrentToolCall` removed entirely (class, provideService, `Services` Exclude
  special-casing, index export). `onToolCall` → `onToolCallStart({ index, name, input })` +
  `onToolCallEnd({ index, name, input, durationMs, outcome: "success"|"failure", message? })`.
  End fires symmetrically via `Effect.tap`/`tapError` around the settling portion (host run +
  output decode + boundary copy; search too — its post-record body is wrapped in `Effect.try`
  so failures are typed and observable). `message` is the model-safe failure message
  (`ToolError`/`ToolRuntimeError` message, else "Tool execution failed"). Interrupted calls
  fire no end event (timeout kills the whole execution anyway).
- **Limits collapse**: public `ExecutionLimits` = `{ timeoutMs?, maxToolCalls?,
  maxOutputBytes? }` (defaults 10_000 / 100 / 32_000). All other knobs are internal defaults
  (unchanged values) on `ResolvedExecutionLimits`, still validated + reachable through the
  `@internal` `InternalExecutionLimits` type exported from `src/codemode.ts` only — tests pass
  internal knobs via typed variables (assignment from a wider variable skips excess-property
  checks).
- **`maxOutputBytes` truncation** (CodeMode-owned, never fails): applied via `boundOutput` in
  a final `Effect.map` over every result path (success/timeout/normalized failure). Oversized
  serialized values become truncated text + ` [result truncated: N bytes exceeds the M-byte
  output limit; return a smaller value]`; logs keep leading lines within the remaining budget
  + `[logs truncated: showing K of N lines]`; result gains `truncated: true` (also added to
  `ExecuteResultSchema`). UTF-8-safe truncation (no split code points). The in-sandbox
  `maxDataBytes` check on the final result still throws first if the raw value exceeds it.
- **Search polish**: default limit 12 → **10** (`defaultSearchLimit`); exact-path lookup — a
  trimmed query equal to one tool path (optionally `tools.`-prefixed) returns that tool alone
  (`total: 1`), bypassing ranking. Tokenization/ranking/shape unchanged.

### Wave 3 — OpenCode MCP adapter (done)
`packages/opencode/src/session/code-mode.ts` rewritten as a thin adapter over this package;
the vendored rune interpreter is gone. Same `define(mcpTools, mcpDefs, servers)` signature, so
`tools.ts` gating (flag on + MCP tools exist → single `execute` tool, early-return suppresses
per-MCP registration; MCP resource tools unaffected) is unchanged.

- **Tool tree**: `groupByServer` (longest-sanitized-prefix, ported) groups flat `server_tool`
  keys into `CatalogEntry`s carrying the raw MCP `inputSchema`/`outputSchema` as render-only
  JSON Schema; `toolTree` turns each into `Tool.make({ description, input, output?, run })`
  under `tools.<server>.<tool>`. The agent-facing description is
  `CodeMode.make({ tools }).instructions()` over a preview tree (placeholder runs, never
  invoked) — so signature rendering, the inline-vs-search switch, and `$codemode.search`
  availability all come from this package and stay consistent with execution.
- **`run` path**: per-child permission ask first (`ctx.ask({ permission: entry.key, patterns:
  ["*"], always: ["*"] })`, exactly the old gating; approving `execute` approves no child).
  Denials and host failures are mapped to `toolError(message)` so they surface as safe,
  catchable in-program failures (MCP `isError` text propagates as `e.message`; without this
  they'd be sanitized to "Tool execution failed"). Dispatch reuses the ai-sdk wrapper from
  `catalog.convertTool` (`entry.tool.execute!`), which owns callTool timeouts/progress-reset.
- **Result shaping** (`toSandboxResult`): prefer `structuredContent`; else joined text
  content; media (image/audio/resource blob/resource_link) NEVER enters the sandbox — blocks
  are stripped into a per-execution `Attachment[]` accumulator, and a media-only result
  becomes a marker payload (`"[1 image attached to the result]"`, noun/count adjusted). An
  MCP-shaped result with nothing extractable becomes `null`; non-MCP values pass through.
  No handles, no `Result<T>` envelope, no base64 in the sandbox, no raised `maxDataBytes`.
- **Execute result**: `{ output: formatValue(value) + trailing "Logs:" section (success AND
  error — logs are plain pre-formatted lines now), attachments: accumulated }` through the
  existing `Tool.ExecuteResult.attachments` → `message-v2.ts` vision plumbing; attachments
  ride on both success and error results. Diagnostic `suggestions` not already contained in
  the message are appended to error output. Native outer truncation stays on (adapter never
  sets `metadata.truncated`); CodeMode's own `maxOutputBytes` (32 KB default) cuts first.
  Limits: `{ timeoutMs: 30_000 }` (matches the default MCP request timeout), rest defaults.
- **Progress**: `onToolCallStart`/`onToolCallEnd` → `ctx.metadata({ toolCalls })` with
  `{ tool, status: running|completed|error, input? }` per call index — the exact shape the
  TUI `Execute` component (`packages/tui/src/routes/session/index.tsx`) already renders.
  `$codemode.search` calls stream through the same channel.
- **Deletions/deps**: `src/session/rune/` (all five files) and
  `test/session/rune-parity.test.ts` (superseded by this package's `test/parity.test.ts`)
  deleted; `acorn` removed from opencode deps, `typescript` moved back to devDependencies,
  `"@opencode-ai/codemode": "workspace:*"` added; `bun install` run (lockfile updated).
- **Tests**: both opencode suites rewritten against the adapter design —
  `code-mode.test.ts` (34: grouping, description/signature rendering incl. the large-catalog
  search fallback, execution, permission flow + denial, metadata streaming, attachment
  accumulation + media-only marker, logs on success/error, truncation marker,
  `toSandboxResult`/`formatValue`/`withLogs` units) and `code-mode-integration.test.ts`
  (16: real in-memory MCP server; native structured results, attachment accumulation, isError
  propagation, logs, permissions, live metadata). Old envelope/attachment-handle/`$rune`
  describe/`renderType`/`rankTools` tests died with the old design (58+17+24 → 34+16).

### Wave 4 — instructions/prompting + polish (done)
Instructions are now the budgeted-catalog + prompting-guidance form; verified e2e against a
real MCP config. Package still 101 tests / 0 fail; opencode adapter suites still 34 + 16; both
packages typecheck clean.

- **Budgeted catalog** (`discoveryPlan` in `tool-runtime.ts`): the all-or-nothing
  inline/search modes are gone — `DiscoveryMode` deleted, `DiscoveryOptions` is just
  `{ maxInlineCatalogBytes? }` (default 16,000 UTF-8 bytes). Port of the old opencode
  `describe()` `PREVIEW_BUDGET` algorithm, adapted to `ToolDescription`: every namespace is
  ALWAYS listed with its tool count; full signature lines
  (`  - <signature> // <first line of description, capped at 120 chars>`) are inlined
  cheapest-first (line byte length, path tiebreak) within each namespace, namespaces processed
  alphabetically; once one line does not fit, inlining stops for every remaining namespace
  (counts only), exactly like the ported algorithm. The header states comprehensiveness
  precisely: "Available tools (COMPLETE list — …)" vs "Available tools (PARTIAL — N of M
  shown; find the rest with tools.$codemode.search)"; namespace labels are `(N tools)` /
  `(N tools, K shown)` / `(N tools, none shown)`. An empty tree renders "No tools are
  currently available."
- **Search always registered** (documented decision): `DiscoveryPlan.searchIndex` is required
  and built unconditionally (new exported `ToolRuntime.searchIndex(tools)`; `SearchEntry` type
  exported); `CodeMode.execute` (one-shot) passes it too, preserving the
  `execute`≡`make().execute` law. A speculative `tools.$codemode.search` call on a small
  catalog now succeeds instead of `UnknownTool`, and unknown-tool suggestions always point at
  search. Search is *advertised* in the instructions only when the inlined list is PARTIAL,
  keeping small-catalog instructions tight.
- **Prompting content** in `instructions()`, mapping 1:1 to the §5 transcript failures:
  parse-string-results-as-JSON, return-small, console-for-intermediates, and
  read-the-description-before-calling guidance. (The flat prose layout this wave produced
  was later replaced wholesale by the markdown-section restructure — see Post-wave fixes —
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
  resource tools unaffected); the live description read back as "Available tools (PARTIAL —
  56 of 88 shown; find the rest with tools.$codemode.search):" with correct per-namespace
  labels (context7/github/memory fully shown; playwright/sentry/sequential-thinking "none
  shown" — alphabetical exhaustion); programs executed with in-program `$codemode.search`
  calls and returned the correct answer. NOT verified e2e (headless only; covered by
  unit/integration tests instead): TUI child-call rendering, attachments becoming visible
  images, output truncation.

### Wave 5 — Promise generalization (done)
First-class promise values in the interpreter; the direct-tool-call-only `Promise.all`
restriction (and its bespoke AST checks) is gone. Package suite is 136 tests / 0 fail (35 new
in `test/promise.test.ts`); adapter suites and both typechecks unchanged/green; the opencode
adapter needed **no changes**.

- **Decision: eager fork** (`const p = tools.a.b(x)` starts the call immediately on a
  supervised child fiber; `await p` observes its settlement). Chosen over lazy because:
  (1) it's spec-faithful — JS promise work starts at call time, so
  `const a = t1(); const b = t2(); return [await a, await b]` gets real parallelism instead of
  silently sequential awaits; (2) run-once is free — a fiber settles exactly once and
  `Fiber.await` is idempotent, so `await p` twice or `Promise.all([p, p])` can never re-invoke
  the tool (lazy needs a deferred/latch to match); (3) effect's structured concurrency does the
  hard part — `Effect.forkChild` children are auto-supervised (interrupted when the parent
  fiber exits) and `Effect.timeoutOrElse` is `raceFirst`, which runs the program on its own
  raced fiber, so forked calls cannot escape the timeout (tested: in-flight forks are
  interrupted, awaited or abandoned, direct or inside `Promise.all`).
- **Mechanics**: `SandboxPromise` in `values.ts` (fiber-backed for tool calls; fiberless
  `immediate` effect for `Promise.resolve`/`reject`). Forks run
  `semaphore.withPermit(invoke)` with `startImmediately: true` — a per-execution
  `Semaphore.makeUnsafe(maxConcurrency)` (8) caps live calls (the "Effect.all or equivalent"
  cap lives where the work is, so combinator joins can be sequential without losing
  parallelism), and the budget/audit charge (`recordCall`) plus `onToolCallStart` fire at the
  call site before any await. `await` of a non-promise is a passthrough no-op; a returned
  top-level promise resolves like an async-function return (`return tools.a.b(x)` works
  without await).
- **Promise combinators are normal functions over values**: `Promise.all`/`allSettled`/`race`
  accept any array (or spreadable collection) mixing promises and plain data — inline, built
  beforehand, spread, nested in variables. `allSettled` yields
  `{ status: "fulfilled", value } | { status: "rejected", reason }` with reasons produced by
  the same `caughtErrorValue` helper the `catch` binding uses (factored out of
  `evaluateTryStatement`). `race` resolves/rejects with the first settlement and interrupts
  losing in-flight calls; awaiting an interrupted loser afterwards is a catchable program
  failure ("interrupted because another value settled a Promise.race first"), while any other
  interrupt-only settlement keeps propagating as interruption (preserving the
  host-interruption law). `Promise.resolve` flattens promises; `Promise.reject` rejects with
  the reason via `ProgramThrow`.
- **Opaqueness/boundaries**: promises are runtime references — `typeof` → `"object"` (real JS),
  operators reject them, `copyIn` raises an await-hinting `InvalidDataValue` ("contains an
  un-awaited Promise; await tool calls (…) before using their results") for results, tool
  arguments, and `JSON.stringify` instead of `{}`. Property access on a promise is a
  deliberate error (not the forgiving `undefined`): `.then/.catch/.finally` →
  `UnsupportedSyntax` pointing at `await` + try/catch; anything else → "await it first".
  `new Promise(...)` → UnsupportedSyntax ("tool calls already return promises");
  `Promise.<unknown>` lists the five available statics. `console.log(p)` prints
  `[Promise (await it to get its value)]`.
- **Program-end drain**: on successful completion the interpreter awaits still-running
  un-awaited fibers (like a runtime waiting on in-flight I/O at exit), so fire-and-forget
  calls complete deterministically; a failure nobody could have handled surfaces as an
  "Unhandled rejection from an un-awaited tool call: …" diagnostic (kind preserved,
  suggestion says to await) — keeping pre-wave failure visibility for un-awaited
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
  (interpreter callbacks compose synchronously) — the parallel idiom is mapping to un-awaited
  calls and awaiting `Promise.all`, which the instructions show.

### Post-wave fixes

- **Key enumeration: `Object.keys(tools)` + `for...in` (done).** Motivating transcript: a
  model tried to enumerate tool namespaces with `Object.keys(tools)` (failed with the generic
  "Object.keys input must contain plain objects only." — `tools` is a `ToolReference`, not
  plain data) and then `for (const key in tools)` ("Syntax 'ForInStatement' is not
  supported"), and had to fall back to guessing namespace names from the instructions —
  defeating discovery. Fixes, all in this package:
  - `ToolRuntime.make` now returns a `keys(path)` capability (`namespaceKeys` in
    `tool-runtime.ts`) threaded into the `Interpreter` alongside `invoke` — the interpreter
    still never holds the host tool tree. `Object.keys(tools)` yields the top-level namespace
    names (never `$codemode`, which is virtual — but `Object.keys(tools.$codemode)` yields
    `["search"]`), `Object.keys(tools.ns)` the names at that node; a callable tool leaf
    enumerates as `[]` (like `Object.keys` of a JS function); an unknown path throws an
    `UnknownTool` diagnostic suggesting `Object.keys(tools)` and `$codemode.search` (matching
    call-time unknown-tool behavior rather than silently returning `[]`).
  - `Object.values`/`Object.entries` (and every other `Object.*` helper) on a tool reference
    now fail with "…not plain data. Use Object.keys(tools) for names, or
    tools.$codemode.search({ query }) for signatures." instead of the generic message.
  - `Object.keys(array)` returns index strings (`["0", "1", ...]`) like real JS (was a
    Backlog item).
  - `for...in` (ForInStatement) iterates own enumerable string keys of plain objects, index
    strings of arrays, and namespace/tool names of tool references — sharing the interpreter's
    `enumerableKeys` helper with the `Object.keys` tool path. const/let declarations and bare
    identifiers bind the key; break/continue work; iterations charge the operation budget like
    the other loops. Anything else (strings, Map/Set, numbers, null, ...) is a clear error
    suggesting `for...of` or `Object.keys` — deliberately smaller than real JS (which yields
    indices for strings and zero iterations for Maps/Sets/null).
  - `supportedSyntaxMessage`, the instructions loops line, and README "Supported Programs"
    mention the new surface; tests in `test/enumeration.test.ts` (15, incl. the exact
    transcript program) plus one adapter-level assertion that `Object.keys(tools)` returns
    MCP server names.

- **Search ranking, namespace scoping, prefixed result paths (done).**
  Motivation: the Wave 4 e2e run showed a model retrying calls because search-result paths
  lacked the `tools.` prefix (a Backlog item), and the word-set ranker missed
  parameter-name and partial-word queries. Fixes:
  - **Ranking ported from the pre-rebuild implementation** (the `searchTextFor`/`tokenize`/
    `rankTools` algorithm in `packages/opencode/src/session/code-mode.ts` at git HEAD),
    replacing the word-set ranker in `tool-runtime.ts`. Searchable text per tool = path +
    description + input-schema property names + their `description` strings — extracted by
    the new `inputProperties` helper in `tool.ts` (Effect Schemas via
    `Schema.toJsonSchemaDocument`, the same emission signature rendering uses; JSON Schemas
    read `properties` directly, resolving a trivial top-level `$ref`; try/catch falls back to
    path + description). Queries tokenize on camelCase boundaries + non-alphanumeric
    separators (empties and `*` dropped). Additive per-term scoring: exact path or
    path-segment match 20, path substring 8, description substring 4, searchable-text
    substring 2; summed across terms, filtered to score > 0, sorted score desc then path asc.
    An empty query now browses ALPHABETICALLY by path (was declaration order). Kept:
    `{ path, description, signature }` result items, default limit 10, exact-path instant
    lookup, input validation errors.
  - **Namespace scoping**: `tools.$codemode.search({ query?, namespace?, limit? })` —
    `namespace` (validated as a string when provided) filters `SearchEntry`s to one top-level
    namespace before ranking; `{ query: "", namespace: "github" }` lists that namespace
    alphabetically. `searchSignature` updated.
  - **Prefixed result paths**: search-result `path`s are `tools.github.list_issues` style,
    directly usable as the call site. Internal `ToolDescription.path` stays unprefixed; only
    the search RESULT items are prefixed. Exact-path queries accept both forms, as before.
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
  be truncated or skimmed away) and the catalog at the bottom:
  - **Intro** (2 lines): "Write a CodeMode program… Return code only." + "Execute
    JavaScript in a confined runtime with access to the tools listed below under
    `tools.*`." (the second line drops the tools clause when the tree is empty).
  - **`## Workflow`**: numbered steps — find a tool via `tools.$codemode.search` → read
    the `{ path, description, signature }` matches → call by path → `typeof res ===
    "string" ? JSON.parse(res) : res` → return only the needed fields. When the catalog is
    COMPLETE the search/read steps collapse into "Pick a tool from the list under
    `## Available tools`" and the steps renumber (4 instead of 5).
  - **`## Rules`**: call-by-exact-path; TEXT-is-JSON → JSON.parse; return small (never raw
    payloads); filter/aggregate large collections in code instead of per-item round-trips;
    console.log/warn/error/dir/table for intermediates; `Promise.all` parallelism (no
    .then/.catch — await + try/catch); `Object.keys(tools)`/`for...in` enumeration;
    browse-one-namespace via search (PARTIAL only); and host-side media handling (files/
    images never enter the program; a media-only call yields a small text marker — wording
    verified against the adapter's `toSandboxResult`/`mediaMarker`).
  - **`## Syntax`**: the dense syntax lines unchanged, minus the Promise.all and console
    lines (moved into Rules) and the `for (const ns in tools)` fragment (redundant with
    the enumeration rule).
  - **`## Available tools`**: the budgeted catalog unchanged, with the COMPLETE/PARTIAL
    header merged into the section heading (no trailing colon); the search-signature
    advertisement follows when PARTIAL (its description-reading and browse clauses moved
    to Workflow/Rules).
  - Every call form in Workflow/Rules uses explicit `<namespace>.<tool>`/`<field>`
    placeholders — the example builder that derived a worked example from the first inlined
    catalog tool (`exampleArguments` + the example-selection machinery) is DELETED, so no
    real catalog tool is cherry-picked into examples and no fabricated names or fields
    appear anywhere in the instructions. Zero tools keep "No tools are currently
    available." under minimal sections (intro + Syntax + Available tools).
  - **Tests**: the package worked-example test replaced by section-structure/placeholder
    assertions (section order; JSON.parse + return-small rules present; no
    `total_count`/`list_issues`/real-tool example lines; browse hint only when PARTIAL;
    zero-tool minimal sections) — 156 pass / 0 fail; adapter suites gain the same
    assertions on the built description (still 35 + 16, green).

---

## 4. Remaining work (detailed TODO)

### Backlog / loose ends (non-blocking, any order)
- [ ] Medium-tier JS parity items deferred from the original audit: caught errors are plain
      `{ name, message }` objects, not `instanceof Error` (and `Error` isn't a value —
      `x instanceof Error` is unsupported syntax); `splice` (still a
      "rewrite using map/filter" hint) and array `entries()/keys()/values()`;
      `localeCompare`/`normalize`/`trimLeft`/`trimRight`; friendlier regex-y error messages.
- [ ] `console.log(NaN)` prints `"null"` (goes through the boundary chokepoint) — could
      special-case number formatting in `formatConsoleArgument`.
- [ ] Sandbox values nested inside logged containers print `[CodeMode reference]`
      (`console.log({ m: map })`) — could deep-format instead.
- [ ] `Date`/`Map`/`Set`/`RegExp` values passing through `Object.*` helpers and coercion
      checkpoints take their JSON forms (e.g. `Object.values({ d: date })` yields the ISO
      string, not the Date). Deliberate (documented in README); revisit only if it bites.
- [ ] Decide whether OpenCode's outer native truncation gets disabled for `execute` once
      `maxOutputBytes` exists (issue says CodeMode reimplements it; "maybe we kill \[the outer
      one\] later").
- [ ] Two timing-based tests in `test/promise.test.ts` (a `< 150ms` parallelism bound and
      100ms-timeout interruption) could flake on a very slow CI host; primary assertions are
      counter-based, but loosen margins if they ever flake.
- [ ] Interactive e2e still unverified (Wave 4 verified headless only): TUI child-call
      rendering via `metadata.toolCalls`, and stripped media becoming visible images through
      `Tool.ExecuteResult.attachments`. Run one interactive session before merging.
- [x] Commit hygiene: Waves 0–5 + post-wave fixes committed on `codemode-v2` as two units
      (the generic package; the OpenCode integration). Future work: commit only when
      explicitly asked; push with `--no-verify` per repo convention. The scratch
      `.opencode/opencode.jsonc` stays uncommitted.

---

## 5. Context and gotchas for whoever picks this up

- **Motivating failure (why forgiving semantics + prompting matter):** in a real transcript,
  the model wrote `me.result?.login ?? me.result` where the tool result was a JSON *string* —
  the old strict interpreter threw (`String property 'login' is not available`); then the
  model returned a raw 105KB payload, which native truncation dumped to a file, costing a
  subagent round-trip to extract one number. Interpreter forgiveness stops the crashes;
  Wave 4 prompting stops the payload dumping. Both are needed.
- Realistically **all MCP tools render `Promise<unknown>`** (no outputSchema), so the
  instructions prose is the only lever for result-shape behavior in the dominant case.
- **`copyIn` has two roles**: host↔sandbox boundary AND intra-sandbox data checkpoint
  (`boundedData`). Sandbox value types are converted to JSON forms wherever it runs — that's
  the documented model. If you add a new value type, follow the Wave 1b-i pattern: class in
  `values.ts`, opaque-by-default via `isRuntimeReference`, explicit carve-outs, real byte
  accounting in `runtimeValueBytes`, JSON form in `copyIn`, console formatting, tests.
- The interpreter throws synchronously inside `Effect.gen`/`Effect.sync` freely; everything is
  normalized by `catchCause` → `normalizeError` into `Diagnostic` data. Program failures are
  **data, never Effect failures**; only interruption propagates.
- `parseProgram` wraps source in `async function __codemode__() { ... }`, transpiles TS, then
  slices between the first `{` and last `}` — line/col diagnostics are offset accordingly
  (`sourceLocation`). Don't inject prologue code; it breaks the offsets.
- OpenCode wraps every tool's output with auto-truncation (`Tool.define` wrapper,
  `truncate.output`, 2000 lines / 50KB, saves full output to disk and appends a hint) unless
  `metadata.truncated` is set. The `execute` tool currently rides that for free.
- Effect version: both repos pin `effect@4.0.0-beta.83` via bun catalogs. This package uses
  v4-only APIs (`Schema.Decoder`, `Schema.toJsonSchemaDocument`, `Context.Service`,
  `Cause.hasInterruptsOnly`, `Effect.timeoutOrElse`). The effect-smol checkout referenced in
  the workspace is the implementation source of truth for v4 behavior questions.
- File map (this package): `src/codemode.ts` — types/limits/parser/Interpreter/execute/make;
  `src/tool-runtime.ts` — tool tree, `copyIn`/`copyOut`, search/discovery, invoke path;
  `src/tool.ts` — `Tool.make` + JSON-Schema→TS rendering; `src/values.ts` — sandbox value
  types; `src/tool-error.ts` — `ToolError`; tests in `test/{codemode,parity,stdlib}.test.ts`.
- OpenCode file map (integration points): `src/session/code-mode.ts` (adapter, rewritten in
  Wave 3); `src/session/tools.ts:93-115,406` (gating/registration); `src/mcp/index.ts`
  (`MCP.tools()`/`MCP.defs()`); `src/mcp/catalog.ts` (`convertTool`, `server_tool` naming);
  `src/tool/tool.ts` (`ExecuteResult.attachments`, truncation wrapper);
  `src/session/message-v2.ts` (attachments → vision); `packages/tui/src/routes/session/index.tsx`
  (`Execute` progress component); `src/effect/runtime-flags.ts` (feature flag).
