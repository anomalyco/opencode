# Rune

A sandboxed JavaScript interpreter. It runs untrusted model-authored code that calls
host-provided tools and transforms plain JSON. It is **not** a JS engine: it walks an
AST and hand-implements an allowlisted subset of the language. Anything not explicitly
implemented throws.

## How it works

### Pipeline (`Rune.execute`)
1. **Wrap** the source in `async function __rune__() { ... }`.
2. **Transpile** via the TypeScript compiler (`transpileModule`, target ESNext) — strips
   types only. Runtime-agnostic (no `Bun.Transpiler`, no Node `module` APIs).
3. **Parse** the stripped body with `acorn` → ESTree AST. (Acorn is a parser only: it
   provides zero runtime/stdlib.)
4. **Interpret**: a tree-walking evaluator (`Interpreter`) executes the AST as an
   `Effect`. Host tool calls are async; everything else is synchronous evaluation.

### Values
- Only **Data Values** cross boundaries: `null`, `undefined`, `boolean`, `number`,
  `string`, and null-prototype objects/arrays of Data Values.
- `copyIn`/`copyOut` deep-clone at every boundary (tool args, tool results, return).
  Runtime references (functions, `tools`) never leak into data.
- Objects are null-prototype (no inherited `Object` methods, no prototype pollution).

### Tools
- The host passes a tree of functions under `tools`. The program calls
  `await tools.<path>(...)`; the interpreter resolves the path and invokes the host
  function, copying args in and the result back.
- Unknown path → `UnknownCapability`. Host failures surface as catchable in-program
  errors.

### Result
`{ ok: true, value, toolCalls }` or `{ ok: false, error: { kind, message, location?,
suggestions? }, toolCalls }`. `value` is the program's `return`. Uncaught `throw`
becomes `ok: false`.

### Limits (`ExecutionLimits`, enforced; defaults)
| Limit | Default | Bounds |
|---|---|---|
| `maxOperations` | 100,000 | interpreter steps (kills infinite loops) |
| `timeoutMs` | 10,000 | wall-clock |
| `maxToolCalls` | 100 | tool invocations |
| `maxConcurrency` | 8 | in-flight `Promise.all` calls |
| `maxSourceBytes` | 32,000 | source size |
| `maxDataBytes` | 256,000 | any single data value (args/result/assignment/return) |
| `maxAuditBytes` | 1,000,000 | cumulative tool-call audit trail |
| `maxValueDepth` | 32 | nesting depth of a data value |
| `maxCollectionLength` | 10,000 | elements/keys in one array/object |

Bytes are measured ~`JSON.stringify(value).byteLength`. `maxDataBytes` is per-value,
not cumulative. (Code mode overrides `maxDataBytes`→10MB, `timeoutMs`→30s.)

## Standard library (allowlist — everything else throws)

- **Globals**: `tools`, `Promise`, `Object`, `Math`, `JSON`, `Number`, `String`,
  `Boolean`, `Array`, `parseInt`, `parseFloat`, `undefined`.
- **String**: case/trim, split, slice/substring/substr, includes/startsWith/endsWith,
  indexOf/lastIndexOf, replace/replaceAll, repeat, padStart/padEnd, charAt/at,
  charCodeAt/codePointAt, concat. **String args only.**
- **Array**: map/filter/reduce/reduceRight/forEach/find/findIndex/some/every/sort/
  toSorted/slice/concat/flat/flatMap/reverse/toReversed/with/join/includes/indexOf/at +
  push/pop/shift/unshift.
- **Object**: keys/values/entries/hasOwn/assign/fromEntries.
- **Math**: max/min/abs/floor/ceil/round/trunc/sign/sqrt/cbrt/pow/hypot/log/log2/log10/
  exp, PI, E.
- **Number**: isInteger/isFinite/isNaN/isSafeInteger/parseInt/parseFloat; instance
  toFixed/toExponential/toPrecision/toString(radix).
- **JSON**: parse, stringify (no replacer).
- **Syntax**: arrow + `function` (hoisted), closures, default/rest params, destructuring,
  spread, optional chaining, template literals, conditionals, switch, loops, `for...of`,
  try/catch, ternary, `in`, logical assignment, bitwise ops, `await`, `Promise.all`.

## What is missing

- **`Date`** — no dates or time.
- **`RegExp` / regex literals** — none. `replace`/`split` take plain strings only.
- **`Map` / `Set` / `WeakMap` / `WeakSet`** — none.
- **`console`** — no logging/output.
- **`Promise`** — only `Promise.all`. No `new Promise`, `race`, `allSettled`, `resolve`,
  `reject`.
- **`new`** — only the `Error` family (`Error`, `TypeError`, `RangeError`, `SyntaxError`,
  `ReferenceError`, `EvalError`, `URIError`), and they yield plain `{ name, message }`
  data objects, not real `Error` instances.
- **Classes, generators, `async function*`, `for await...of`, labeled break/continue** —
  rejected as `UnsupportedSyntax`.
- **`Symbol`, `BigInt`** — none.
- **Partial built-ins** — e.g. `JSON.stringify` ignores replacers; `Array.from` takes no
  map fn; `NaN`/`Infinity` are not valid data values.
- **No I/O** — no fetch, fs, timers, env, or any ambient capability. The only outside
  contact is host `tools`.

# Code mode (discovery layer)

Code mode (`session/code-mode.ts`) is a *consumer* of Rune, not part of the interpreter. It
exposes connected MCP tools to the program as `tools.<server>.<tool>(input)` and adds its own
discovery capabilities under `tools.$rune.*`. The design deliberately tolerates the mistakes
weaker models commonly make rather than punishing them. The trade-offs below are intentional.

## tools.$rune.search(query, { namespace?, limit? })

Ranked, in-memory search over the tool catalog, recomputed per call (no persistent index).
Returns `{ items: [{ path, description }], total }`.

- **Weighted, tokenized scoring** (`rankTools`): per query term, exact path segment (20) >
  path substring (8) > description (4) > any indexed text (2), summed across terms. The
  indexed text is the path, the description, and each input parameter's name + description —
  so a query can match a tool by one of its argument names.
- **camelCase / separator-resistant tokenizer** (`tokenize`): splits camelCase boundaries and
  treats `_ - . /` as separators, so `library`, `resolveLibraryId`, and `resolve-library-id`
  all tokenize alike. Models phrase queries inconsistently; this keeps recall up without the
  query having to match a tool's exact casing or punctuation.
- **Namespace scoping**: optional `namespace` filters to one server. An empty query (or bare
  `*`) lists everything alphabetically. `limit` caps `items` (default 25); `total` always
  reports the full match count so the model knows when results were truncated.

## tools.$rune.describe(path)

Returns `{ path, description, signature, input, output? }` for one tool. **Everything is
TypeScript — no raw JSON Schema is ever surfaced to the model.**

- **Compact signature + detailed TS types.** `signature` is the one-line call form, e.g.
  `tools.github.create_issue(input: { title: string; body?: string }): Promise<Result<unknown>>`,
  where `type Result<T> = { result: T; attachments?: Attachment[] }` is defined once in the tool
  description prose so signatures stay short.
  `input` (and `output`, when the server declares an `outputSchema`) are the *detailed* types
  rendered by `renderType` in pretty mode: an indented block with `/** … */` JSDoc on described
  fields and literal unions for enums. This carries everything the raw JSON Schema used to —
  parameter docs, enums, required-ness — now expressed as TypeScript rather than a schema blob.
  A field's `description` becomes a JSDoc comment (single-line `/** … */`, or a multi-line
  block, preserved as written) because a bare type has nowhere else to hold it; `*/` in a
  description is neutralized so it cannot close the comment early. `describe` is on-demand, so
  keeping the docs costs nothing on the hot path.
- **`renderType` is a total, cycle-safe JSON-Schema → TS renderer.** Local `$ref`s
  (`#/$defs/…`) are resolved against the document root; a self-referential ref collapses to its
  name rather than looping. It renders enums/`const` as literals, `anyOf`/`oneOf` and nullable
  `type` arrays (`["string","null"]` → `string | null`) as unions, `allOf` as an intersection
  (unwrapping the common Pydantic `allOf: [{ $ref }]` shape), tuples, and
  `additionalProperties` as an index signature. It never throws — unknown shapes fall back to
  `any`/`object`, and depth is capped. (Rune's own Effect-schema renderer in `rune/tool.ts`,
  `renderSchema`, is separate and has known gaps — no `$ref` cycle guard, and unions containing
  a number collapse to `number`; code mode does not use it.)
- **Return type shown ahead of the call — in the preview too.** Every tool resolves to
  `Result<T>`, where `T` is the structured `outputSchema` when the server declares one, else
  `unknown`. The `T` is surfaced not just by `describe` but in the budgeted inline preview in the
  tool description (`tools.x.y(input: …): Result<T>`), so the model sees a tool's result shape
  without a discovery round-trip.   `unknown` is deliberate — an untyped result has no guaranteed
  shape (many MCP servers return plain text), so the prose directs the model to inspect it (e.g.
  `return` it) before assuming fields, rather than pretending a shape we can't verify.

## Attachments are opaque handles — bytes never enter the sandbox

A tool's media (image/audio/resource content blocks) becomes an `attachments` array on the
result envelope, but the program only ever sees an **opaque handle**, not the bytes:
`type Attachment = { type: 'file'; id: string; mime: string; filename?: string; bytes?: number }`.
The real bytes (a base64 `data:` URL) are kept host-side in a per-execution `attachmentTable`
keyed by `id` (`code-mode.ts`); the handle carries only metadata. The program can inspect
`mime`/`bytes`, **propagate** a handle (return it under `attachments` to show the user), or
**drop** it — but it cannot read or re-emit the contents. On `return`, each propagated handle is
resolved back to its real attachment via the table; a fabricated or stale handle resolves to
nothing and is dropped.

This is a deliberate divergence from the prior art we studied (both expose the base64 directly
and lean on prompt guidance plus output truncation). Making the handle opaque means a careless
`return`/log **cannot** dump a base64 blob back into the conversation — the leak is structurally
impossible rather than merely discouraged. The trade-off: a program can no longer read attachment
bytes to route them into another tool's input; if that need arises it would be an explicit host
call (e.g. a `readAttachment(handle)`), not the always-on default. Not implemented yet.

## Path handling — separator-tolerant

The flat catalog key is `server_tool`, but the model is never required to guess the
separator. `toKey` normalizes `. / _` to the same key, so `tools.context7.resolve-library-id`,
`describe('context7/resolve-library-id')`, and `describe('context7_resolve-library-id')` all
resolve to the same tool. A slash-vs-dot mismatch previously made `describe` silently miss
(returning a soft error the model then destructured into `{}`); normalizing the separator
removes that whole failure mode.

## Tool-call errors throw; discovery errors are soft

A **tool call** that fails (an MCP `isError`, a transport failure, or a call to a path that
doesn't exist) throws inside the program, so the model uses ordinary `try`/`catch` — the same
control flow it already writes for any async call. We deliberately do *not* wrap results in an
`{ ok, error }` value: a uniform success envelope (`{ result, attachments? }`) plus normal
exceptions is simpler to reason about and to type than forcing every call site to branch on a
discriminated union. An uncaught tool error fails the whole `execute` run and is reported back.

The **discovery helpers** are the exception — see below.

## Discovery errors are soft, with "did you mean" — never thrown

`tools.$rune.search` and `tools.$rune.describe` never throw. An unknown `describe(path)`
returns `{ error: { code: 'tool_not_found', message, suggestions } }`. Suggestions come from a
fuzzy fallback: rank the *leaf* name within its namespace, then fall back to a global search,
returning real callable paths (e.g. `context7/resolve-library` → suggests
`context7.resolve-library-id`). This avoids derailing a whole program over one typo — the model
branches on `result.error` and retries with a suggestion. (Tool
*calls* on a genuinely unknown path still surface as a catchable in-program error via Rune's
`UnknownCapability`; only the discovery helpers return soft errors.)

## Not done yet

- **`console` capture** — a program has no way to surface `console.log` output. Rune has no
  `console` (see "What is missing") and the interpreter is frozen, so buffering log output into
  the result envelope is deferred to separate interpreter work rather than faked here.
