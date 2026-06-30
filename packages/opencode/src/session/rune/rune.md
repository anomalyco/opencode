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
