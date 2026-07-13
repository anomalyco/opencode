# CodeMode Interpreter Support

This is the checkable support matrix for CodeMode's confined JavaScript interpreter. It tracks the language and
standard-library surface that programs can use today, plus concrete gaps that may be implemented later.

- `[x]` means the feature is implemented at the scope described here.
- `[ ]` means the feature is unavailable, incomplete, or intentionally divergent as described.
- A checked item does not promise complete ECMAScript edge-case parity. Known differences are listed next to the
  supported surface or under [Known semantic gaps](#known-semantic-gaps).
- [Intentional exclusions](#intentional-exclusions) are boundaries, not backlog.

When behavior changes, update this file and the tests in the same change. The implementation and tests remain the
ultimate source of truth.

## Source and execution model

- [x] JavaScript parsed with the latest syntax accepted by Acorn, then restricted by the interpreter allowlist.
- [x] Erasable TypeScript syntax, including type annotations, type declarations, assertions, and non-null assertions.
      TypeScript is transpiled first; the emitted JavaScript must still use the supported subset.
- [x] Top-level `await` and `return` through the program's implicit async-function scope.
- [x] Explicit `return`, final top-level expression as a REPL-style result, and `null` when no value is produced.
- [x] JSON-like host boundaries with `undefined` and non-finite numbers normalized to `null`.
- [x] Live Date, RegExp, Map, Set, URL, and URLSearchParams values inside CodeMode.
- [x] Tool calls through the host-provided `tools` tree only.
- [x] The global `search(...)` built-in: synchronous tool discovery that counts as an admitted tool call and is
      shadowable by program declarations like other globals.
- [x] Cooperative timeout, an optional total tool-call limit, output bounding, and unrestricted tool-call concurrency.
- [ ] Full JavaScript or TypeScript compatibility. CodeMode is a bounded orchestration language.

## Values and literals

- [x] `null`, `undefined`, booleans, finite and non-finite numbers, and strings.
- [x] Array literals, including holes and spread from arrays, strings, Maps, Sets, and URLSearchParams.
- [x] Object literals with shorthand, computed string/number keys, and object spread.
- [x] Template literals with interpolation.
- [x] Regular-expression literals.
- [x] `NaN` and `Infinity` globals.
- [ ] BigInt literals and values.
- [ ] Symbols.
- [ ] Tagged template literals.
- [ ] Getters and setters in object literals.

## Bindings and destructuring

- [x] `const`, `let`, and accepted `var` declarations.
- [x] Object and array destructuring in declarations, parameters, assignment expressions, and `for...of` bindings.
- [x] Nested patterns, defaults, elisions, and rest elements.
- [x] Assignment to identifiers, object fields, array indexes, and writable URL fields.
- [x] Function declarations are hoisted within their interpreted scope.
- [x] Parameter defaults observe a temporal dead zone for later parameters.
- [ ] JavaScript-correct `var` function scope, hoisting, and redeclaration. Accepted `var` currently behaves like a
      lexical declaration; prefer `let` or `const`.
- [ ] Complete `let`/`const` temporal-dead-zone and declaration-hoisting semantics.
- [ ] Computed object destructuring keys such as `const { [field]: value } = record`.
- [ ] Object destructuring from arrays, such as `const { length } = values`.
- [ ] Iterable array destructuring from Map, Set, string, or URLSearchParams values.
- [ ] Dynamic property deletion with `delete object[key]`.

## Statements and control flow

- [x] Blocks and empty statements.
- [x] `if`/`else` and conditional expressions.
- [x] `switch`, including default clauses and fallthrough.
- [x] `for`, `while`, and `do...while`.
- [x] `for...of` over arrays, strings, Maps, Sets, and URLSearchParams.
- [x] `for...in` over own keys of plain objects, arrays, and tool references.
- [x] Unlabeled `break` and `continue`.
- [x] `try`, `catch`, optional catch bindings, and `finally`.
- [x] `throw` with arbitrary values.
- [ ] Labeled statements, labeled `break`, and labeled `continue`.
- [ ] `for await...of` and async iteration.
- [ ] `with` and `debugger` statements.

## Functions and callbacks

- [x] Function declarations, function expressions, and arrow functions.
- [x] Synchronous and `async` functions.
- [x] Closures, recursion, default parameters, rest parameters, and destructured parameters.
- [x] Expression and block function bodies.
- [x] User callbacks for the supported Array, Map, Set, URLSearchParams, sort, and string-replacement APIs.
- [x] `Boolean`, `Number`, `String`, `parseInt`, `parseFloat`, and URI helpers as callbacks where applicable.
- [x] Async string replacement callbacks; replacements are evaluated sequentially.
- [ ] `this`, `super`, constructor functions, or function prototype methods such as `call`, `apply`, and `bind`.
- [ ] Classes and private fields.
- [ ] Generator functions and `yield`.
- [ ] Async predicates, reducers, and comparators with automatic awaiting. Async mapping can be joined explicitly with
      `Promise.all`, but a promise is not a meaningful predicate or sort result.
- [ ] General built-in callable references as callbacks, such as `values.map(Math.abs)` or
      `records.map(JSON.stringify)`.

## Expressions and operators

- [x] Property access with dot or computed bracket syntax.
- [x] Optional property access and optional calls.
- [x] Function/tool calls and spread arguments.
- [x] Sequence expressions (the comma operator).
- [x] `await` for CodeMode promises; a plain value passes through unchanged, though every `await` still defers its
      continuation one reaction turn.
- [x] `new` for Error types, Date, RegExp, Map, Set, URL, URLSearchParams, and Promise.
- [x] Arithmetic operators: `+`, `-`, `*`, `/`, `%`, and `**`.
- [x] Equality and ordering: `==`, `!=`, `===`, `!==`, `<`, `<=`, `>`, and `>=`.
- [x] Bitwise operators: `&`, `|`, `^`, `~`, `<<`, `>>`, and `>>>`.
- [x] Logical operators: `&&`, `||`, `??`, and `!`, with short-circuiting.
- [x] Unary `+`, unary `-`, `typeof`, `instanceof`, and own-property-only `in`.
- [x] Prefix and postfix `++` and `--`.
- [x] Plain, arithmetic, bitwise, and logical assignment operators.
- [ ] Unary `void` and `delete`.
- [ ] Arbitrary constructors.

## Promises and tools

- [x] Tool calls start eagerly and return supervised, run-once CodeMode promises.
- [x] Direct `await`, repeated awaits, and implicit resolution when a promise is returned from a function/program.
- [x] `Promise.resolve` and `Promise.reject`.
- [x] `Promise.all`, `Promise.allSettled`, `Promise.race`, and `Promise.any` over supported collections containing
      promises and plain values.
- [x] `Promise.all` preserves result order and rejects on the first observed failure without cancelling siblings.
- [x] `Promise.allSettled` returns plain fulfilled/rejected outcome records.
- [x] `Promise.race` settles from the first result without cancelling losers at settlement time.
- [x] Real promise values from `Promise.all`, `Promise.allSettled`, and `Promise.race`; separately constructed
      combinator batches overlap as in normal JavaScript.
- [x] Promise chaining with `.then`, `.catch`, and `.finally`: handlers run deferred in attach order, returned
      promises are adopted, handler throws reject the derived promise, `.finally` preserves the original settlement
      unless its cleanup fails, and direct self-resolution rejects with a `TypeError`.
- [x] Every `await` (including of plain values and already-settled promises) defers its continuation one reaction
      turn, so concurrent async functions interleave at await points as in JavaScript.
- [x] Combinators settle one reaction turn after their deciding member (V8-observable ordering): reactions already
      attached to members run first, and an aggregate cannot beat a plain value settling in the same turn into a
      `Promise.race`. Exact microtask-count parity beyond this observable ordering is not a documented guarantee.
- [x] All still-pending work (race losers, fail-fast `Promise.all` stragglers, and un-awaited calls alike) is
      interrupted when the program returns; rejections that settled un-awaited become `Success.warnings`
      diagnostics. A combinator abandoned inside its final settlement turn counts as pending and is interrupted
      without a warning.
- [x] `try`/`catch` can handle awaited tool and promise failures.
- [x] `Promise.any`: first fulfillment wins; all-rejected rejects with an `AggregateError` whose `errors` array holds
      the catch-normalized reasons in input order, and empty input rejects with an empty `AggregateError`.
- [x] `new Promise((resolve, reject) => ...)`: the executor runs synchronously and receives first-class resolve/reject
      callables that settle the promise exactly once (they may escape the executor and settle later); an executor
      throw rejects unless the promise already settled, resolving with a promise adopts it, and resolving with the
      promise itself rejects with a `TypeError`. Resolver callables work as `.then`/`.catch` handlers and collection
      callbacks but remain opaque references that cannot cross the data boundary.
- [ ] Thenable assimilation (objects with a `then` method are plain data, not promises).
- [ ] Async iterables, host streams, and stream consumption.

## Objects and properties

- [x] Own-field reads and writes on plain data objects.
- [x] Computed property names and object spread.
- [x] `Object.keys`, `Object.values`, `Object.entries`, `Object.hasOwn`, `Object.assign`, and `Object.fromEntries`.
- [x] `Object.keys` over arrays and tool references.
- [x] Object identity is preserved by in-CodeMode Object helpers.
- [x] Blocked access to `__proto__`, `constructor`, and `prototype`.
- [ ] `Object.is`; runtime and tool-reference identity semantics need to be defined first.
- [ ] `Object.groupBy`.
- [ ] Object creation, descriptors, freezing/sealing, prototype APIs, and reflection APIs.
- [ ] A final policy for legal data/tool keys named `__proto__`, `constructor`, or `prototype`.

## Arrays

- [x] Static methods: `Array.isArray`, `Array.of`, and `Array.from`.
- [x] Iteration/transformation: `map`, `filter`, `flatMap`, and `forEach`.
- [x] Searching/tests: `find`, `findIndex`, `findLast`, `findLastIndex`, `some`, `every`, `includes`, `indexOf`, and
      `lastIndexOf`.
- [x] Aggregation: `reduce` and `reduceRight`.
- [x] Ordering: `sort`, `toSorted`, `reverse`, and `toReversed`.
- [x] Access/copying: `at`, `slice`, `concat`, `flat`, `with`, and `join`.
- [x] Mutation: `push`, `pop`, `shift`, `unshift`, `splice`, `fill`, and `copyWithin`.
- [x] Materialized iteration helpers: `keys`, `values`, and `entries` return arrays rather than iterators.
- [x] `length`, numeric indexing, index assignment, spread, and `for...of`.
- [ ] The mapper and `thisArg` forms of `Array.from`.
- [ ] `Array.prototype.toSpliced`.
- [ ] Canonical index handling: a key such as `"01"` must not alias index `1`.
- [ ] Complete sparse-array parity. Promise combinators do consume holes as `undefined` members, as in JS.

## Strings

- [x] Case/normalization: `toLowerCase`, `toUpperCase`, `normalize`.
- [x] Trimming: `trim`, `trimStart`, and `trimEnd`.
- [x] Searching/tests: `includes`, `startsWith`, `endsWith`, `indexOf`, `lastIndexOf`, and `search`.
- [x] Slicing/access: `slice`, `substring`, `at`, `charAt`, `charCodeAt`, and `codePointAt`.
- [x] Construction/transformation: `split`, `concat`, `repeat`, `padStart`, `padEnd`, `replace`, and `replaceAll`.
- [x] Regular-expression integration: `match`, materialized `matchAll`, `replace`, `replaceAll`, `split`, and `search`.
- [x] `localeCompare`; locale and options arguments are currently ignored.
- [x] `toString`, `length`, numeric indexing, spread, and `for...of` by Unicode code point.
- [x] Static `String.fromCharCode` and `String.fromCodePoint`.
- [ ] Locale/options-aware `localeCompare` and locale formatting APIs.
- [ ] Exact native coercion across every string method; CodeMode often requires explicit strings/numbers.
- [ ] Native no-argument parity for `match()` and `search()`.

## Numbers and Math

- [x] Coercion functions: `Number`, `parseInt`, and `parseFloat`.
- [x] Number predicates/parsers: `Number.isInteger`, `Number.isFinite`, `Number.isNaN`, `Number.isSafeInteger`,
      `Number.parseInt`, and `Number.parseFloat`.
- [x] Number formatting: `toFixed`, `toPrecision`, `toExponential`, `toString`, and `valueOf`.
- [x] Number constants: `MAX_SAFE_INTEGER`, `MIN_SAFE_INTEGER`, `MAX_VALUE`, `MIN_VALUE`, `EPSILON`, `NaN`,
      `POSITIVE_INFINITY`, and `NEGATIVE_INFINITY`.
- [x] Math constants: `PI`, `E`, `LN2`, `LN10`, `LOG2E`, `LOG10E`, `SQRT2`, and `SQRT1_2`.
- [x] Math methods: `random`, `max`, `min`, `abs`, `acos`, `acosh`, `asin`, `asinh`, `atan`, `atan2`, `atanh`,
      `floor`, `ceil`, `round`, `trunc`, `sign`, `sqrt`, `cbrt`, `pow`, `hypot`, `cos`, `cosh`, `sin`, `sinh`,
      `tan`, `tanh`, `log`, `log2`, `log10`, `log1p`, `exp`, `expm1`, `f16round`, `fround`, `clz32`, and `imul`.
- [ ] Native zero-argument behavior for `Number()` and `String()`; they currently do not produce `0` and `""`.
- [ ] Safe interpreter coercion for `++` and `--` rather than host `Number(...)` coercion.
- [ ] Reliable feature detection for unknown static members.
- [ ] `Math.sumPrecise`.
- [ ] Global coercing `isFinite` and `isNaN`.

## JSON and console

- [x] `JSON.parse` and `JSON.stringify`.
- [x] Numeric/string indentation for `JSON.stringify`.
- [x] Captured `console.log`, `console.info`, `console.debug`, `console.warn`, and `console.error`.
- [x] Captured `console.dir` and `console.table`.
- [ ] `JSON.parse` reviver callbacks.
- [ ] `JSON.stringify` function/array replacers.
- [ ] Other console methods, timers, counters, groups, and host console access.

## Date

- [x] `Date.now`, `Date.parse`, and `Date.UTC`.
- [x] `new Date()` from the current time, epoch milliseconds, a date string, another Date, or local components.
- [x] `getTime`, `valueOf`, `toISOString`, `toJSON`, and deterministic ISO `toString`.
- [x] Local getters: `getFullYear`, `getMonth`, `getDate`, `getDay`, `getHours`, `getMinutes`, `getSeconds`, and
      `getMilliseconds`.
- [x] UTC getters: `getUTCFullYear`, `getUTCMonth`, `getUTCDate`, `getUTCDay`, `getUTCHours`, `getUTCMinutes`,
      `getUTCSeconds`, and `getUTCMilliseconds`.
- [x] `getTimezoneOffset`, arithmetic, relational comparison, and `instanceof Date`.
- [x] Date values serialize to ISO strings; invalid dates serialize to `null`.
- [ ] Date setters.
- [ ] `toUTCString`, locale methods, and other Date formatting methods.
- [ ] Exact native constructor coercion, local-time, and loose-equality semantics.
- [ ] Native `RangeError` branding for invalid `toISOString()` calls.
- [ ] Temporal and Intl date/time APIs.

## Regular expressions

- [x] Literal and `new RegExp(pattern, flags)` construction.
- [x] `test`, `exec`, and `toString`.
- [x] Readable `source`, `flags`, `lastIndex`, `global`, `ignoreCase`, `multiline`, `sticky`, `unicode`, and `dotAll`.
- [x] Captures, named groups, match indexes, and stateful global matching.
- [x] Integration with supported String methods, including async function replacers.
- [ ] Writable `lastIndex`.
- [ ] Exposed metadata for the `d` and `v` flags.
- [ ] `RegExp.escape`.
- [ ] Protection from pathological host-regex backtracking beyond the cooperative execution timeout.

## Map and Set

- [x] `new Map()` from entry arrays or another Map.
- [x] Map `get`, `set`, `has`, `delete`, `clear`, `size`, and `forEach`.
- [x] `new Set()` from arrays, strings, or another Set.
- [x] Set `add`, `has`, `delete`, `clear`, `size`, and `forEach`.
- [x] Materialized `keys`, `values`, and `entries` arrays for Map and Set.
- [x] Spread, `for...of`, `Array.from`, and `Object.fromEntries` integration.
- [x] Map and Set values serialize to `{}` at host/JSON boundaries.
- [ ] Set composition methods such as `union`, `intersection`, `difference`, and relation predicates.
- [ ] WeakMap and WeakSet.
- [ ] Native iterator objects and custom iterators.

## URL and URI helpers

- [x] `encodeURI`, `encodeURIComponent`, `decodeURI`, and `decodeURIComponent`.
- [x] `new URL(input, base)`, `URL.canParse`, and `URL.parse`.
- [x] URL `toString`, `toJSON`, and linked `searchParams`.
- [x] Readable URL fields: `href`, `origin`, `protocol`, `username`, `password`, `host`, `hostname`, `port`,
      `pathname`, `search`, and `hash`.
- [x] Writable URL fields except `origin`.
- [x] `new URLSearchParams()` from query strings, data objects, pairs, Maps, and URLSearchParams.
- [x] URLSearchParams `append`, `delete`, `get`, `getAll`, `has`, `set`, `sort`, `forEach`, `keys`, `values`,
      `entries`, `toString`, and `size`.
- [x] URL values serialize to their href; URLSearchParams serialize to `{}`.

## Errors and diagnostics

- [x] `Error`, `TypeError`, `RangeError`, `SyntaxError`, `ReferenceError`, `EvalError`, and `URIError`, callable with
      or without `new`.
- [x] `AggregateError` with the `(errors, message?)` signature and an own `errors` array, constructed directly or by
      an all-rejected `Promise.any`.
- [x] Error `name`/`message`, error inheritance through `instanceof`, and plain-data serialization.
- [x] `instanceof` for Date, RegExp, Map, Set, URL, URLSearchParams, Array, Object, Promise, and Error types.
- [x] Catchable interpreter failures and awaited tool failures.
- [x] Source locations on unsupported-syntax diagnostics when available.
- [x] Sanitized model-visible diagnostics and explicit safe `ToolError` messages.
- [ ] Distinct public categories for user throws, tool refusal, tool internal failure, invalid returned data, compile
      failures, and genuine interpreter defects.
- [ ] Preservation of detailed recoverable failure categories inside `catch` and `Promise.allSettled`.

## Known semantic gaps

These are actionable implementation items. Check them off only when behavior and direct tests land.

- [x] Return real promises from `Promise.all`, `Promise.allSettled`, and `Promise.race`.
- [ ] Guarantee every advertised tool path is executable, including dotted and blocked path segments.
- [ ] Define safe outbound handling for non-finite numbers and `undefined` so invalid values cannot silently become
      `null` in render-only or OpenAPI tool calls.
- [ ] Make regular-expression execution genuinely timeout-safe, or narrow the timeout guarantee explicitly.
- [ ] Complete lexical declaration and destructuring semantics listed above.
- [ ] Make callback acceptance and async callback behavior consistent across built-ins.
- [ ] Reject every unsupported callback argument explicitly rather than silently ignoring it.
- [ ] Resolve the built-in correctness gaps listed in the Array, String, Number, Date, and RegExp sections.
- [ ] Make tool search tokenization Unicode-aware.
- [ ] Design explicit tagged representations and size limits before adding binary values or streams.

## Intentional exclusions

These constraints preserve CodeMode's confinement and host-neutral scope. They are not TODO items.

- Ambient filesystem, process, environment, credential, network, or application access.
- `fetch`, timers, crypto, or other host globals unless a future host explicitly supplies a bounded capability.
- Static imports, dynamic imports, modules, npm packages, and module loading.
- `eval`, `Function(...)`, arbitrary host execution, and prototype mutation.
- Generic permission prompts, authorization policy, persistence, replay, or exactly-once side effects.
- Arbitrary method dispatch outside the documented allowlists.
- Automatic parsing of text tool results as JSON.
- Full browser, Node.js, Bun, or ECMAScript runtime compatibility.
