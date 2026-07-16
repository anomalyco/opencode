# CodeMode Interpreter Support

This is the checkable support matrix for CodeMode's confined JavaScript interpreter. It tracks the language and
standard-library surface that programs can use today, plus concrete gaps that may be implemented later.

- `[x]` means the feature is implemented at the scope described here.
- `[ ]` means a concrete compatibility gap remains.
- Checked items do not promise complete ECMAScript edge-case parity; known differences are stated explicitly.
- Intentional boundaries are not listed as compatibility work.

When behavior changes, update this file and the tests in the same change. The implementation and tests remain the
ultimate source of truth.

## Source and execution model

- [x] JavaScript parsed with the latest syntax accepted by Acorn, then restricted by the interpreter allowlist.
- [x] Erasable TypeScript syntax, including type annotations, type declarations, assertions, and non-null assertions.
      TypeScript is transpiled first; the emitted JavaScript must still use the supported subset.
- [x] Top-level `await` and `return` through the program's implicit async-function scope.
- [x] Explicit `return`, final top-level expression as a REPL-style result, and `null` when no value is produced.
- [x] Program results use JSON-like boundaries, with `undefined` and non-finite numbers normalized to `null`. Tool
      arguments remain subject to their schema and the outbound-handling gap listed below.
- [x] Live Date, RegExp, Map, Set, URL, and URLSearchParams values inside CodeMode.
- [x] Tool calls through the host-provided `tools` tree only.
- [x] The global `search(...)` built-in: synchronous tool discovery that counts as an admitted tool call and is
      shadowable by program declarations like other globals.
- [x] Cooperative timeout, an optional total tool-call limit, output bounding, and unrestricted tool-call concurrency.

## Values and literals

- [x] `null`, `undefined`, booleans, finite and non-finite numbers, and strings.
- [x] Array literals, including holes and spread from arrays, strings, Maps, Sets, and URLSearchParams.
- [x] Object literals with shorthand, computed string/number keys, and spread from plain data objects; `null` and
      `undefined` are no-ops, while arrays are rejected.
- [x] Template literals with interpolation.
- [x] Regular-expression literals.
- [x] `NaN` and `Infinity` globals.
- [ ] BigInt literals and in-interpreter BigInt arithmetic; BigInt remains invalid at JSON-like host boundaries.
- [ ] Symbol primitive values and symbol-keyed properties.
- [ ] Tagged-template calls.
- [ ] Getter and setter definitions in object literals.

## Bindings and destructuring

- [x] `const`, `let`, and accepted `var` declarations.
- [x] Object and array destructuring in declarations, parameters, assignment expressions, and `for...of` bindings.
- [x] Nested patterns, defaults, elisions, and rest elements.
- [x] Assignment to identifiers, unblocked plain-object fields, non-negative integer array indexes, and writable URL
      fields.
- [x] Direct function declarations are hoisted in program and block statement lists.
- [x] Parameter defaults observe a temporal dead zone for later parameters.
- [ ] JavaScript-correct function scoping, hoisting, and redeclaration for accepted `var` declarations.
- [ ] Predeclare `let` and `const` bindings in every lexical scope, including program/block bodies, switch bodies, and
      loop headers, so reads before initialization and self- or cross-referential initializers observe the JavaScript
      temporal dead zone.
- [ ] Hoist function declarations accepted directly in switch cases.
- [ ] Computed object destructuring keys such as `const { [field]: value } = record`.
- [ ] Object destructuring from arrays, such as `const { length } = values`.
- [ ] Array destructuring from supported non-array iterables: strings, Maps, Sets, and URLSearchParams.

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

## Functions and callbacks

- [x] Function declarations, function expressions, and arrow functions.
- [x] Synchronous and `async` functions.
- [x] Closures, recursion, default parameters, rest parameters, and destructured parameters.
- [x] Expression and block function bodies.
- [x] User callbacks for the supported Array, Map, Set, URLSearchParams, sort, string-replacement, and `Array.from`
      mapper APIs, with one shared acceptance rule everywhere including promise reactions.
- [x] `Boolean`, `Number`, `String`, `parseInt`, `parseFloat`, and URI helpers as callbacks.
- [x] Built-in method references as callbacks, such as `values.map(Math.abs)`, `records.map(JSON.stringify)`,
      `items.forEach(console.log)`, and `Promise.resolve(-1).then(Math.abs)`. Extra callback arguments a built-in
      does not consume are ignored, like JS; consumed arguments stay strictly validated (`Math.floor` still rejects a
      string). Intrinsic references keep their receiver (`"abc".includes` works as a predicate), unlike detached JS
      methods, which lose `this`.
- [x] Constructors work as callbacks with JS call semantics: `Error` types construct (`messages.map(Error)`),
      and new-requiring constructors (`Map`, `Set`, `URL`, `URLSearchParams`, `Promise`) throw a `TypeError`,
      like JS.
- [x] Tool references and detached `Promise` statics are rejected as callbacks with a hint to wrap them in an
      arrow function.
- [ ] Stop automatically awaiting promise-returning string replacers; match JavaScript's synchronous callback-result
      coercion.
- [x] The optional `thisArg` of iteration methods is accepted and ignored: CodeMode functions have no `this`, so
      ignoring it matches JS arrow-function semantics exactly.
- [ ] `this` in non-arrow CodeMode functions and callbacks.
- [ ] User-defined constructor calls.
- [ ] `Function.prototype.call`, `apply`, and `bind` for CodeMode functions.
- [ ] Classes and private fields.
- [ ] Generator functions and `yield`.

## Expressions and operators

- [x] Property access with dot or computed bracket syntax.
- [x] Optional property access and optional calls.
- [x] Function/tool calls and spread arguments.
- [x] Sequence expressions (the comma operator).
- [x] `await` for CodeMode promises; a plain value passes through unchanged, though every `await` still defers its
      continuation one reaction turn.
- [x] `new` for Array, Object, Error types, Date, RegExp, Map, Set, URL, URLSearchParams, and Promise.
- [x] Arithmetic operators: `+`, `-`, `*`, `/`, `%`, and `**`.
- [x] Equality and ordering: `==`, `!=`, `===`, `!==`, `<`, `<=`, `>`, and `>=`.
- [x] Bitwise operators: `&`, `|`, `^`, `~`, `<<`, `>>`, and `>>>`.
- [x] Logical operators: `&&`, `||`, `??`, and `!`, with short-circuiting.
- [x] Unary `+`, unary `-`, `void`, `typeof`, `instanceof`, and own-property-only `in`.
- [x] Prefix and postfix `++` and `--`.
- [x] Plain, arithmetic, bitwise, and logical assignment operators.
- [x] Property deletion on plain data objects and arrays, including computed and optional forms; deleting an array index
      creates a hole without changing its length.

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
      promise itself rejects with a `TypeError`. Resolver callables work anywhere callbacks are accepted, including
      `.then`/`.catch` handlers and collection callbacks, but remain opaque references that cannot cross the data
      boundary.
- [ ] Thenable assimilation; objects with a callable `then` field remain plain data.
- [x] Dotted tool names are canonicalized into namespace paths; a path can be both callable and a namespace, and the
      last definition supplied for a canonical path wins.
- [x] Tool path segments may be named `constructor`, `prototype`, or `__proto__` because paths use inert Map keys.
- [ ] Reject `undefined` and non-finite numbers in outbound tool arguments before render-only and OpenAPI tools run;
      retain null normalization for program results and JSON serialization.
- [ ] Tokenize and case-fold non-ASCII tool paths, descriptions, and queries for tool search.

## Objects and properties

- [x] Own-field reads and writes on plain data objects.
- [x] `Object()` and `new Object()` return `{}` for nullish arguments and pass objects through unchanged;
      primitive wrapper objects (`Object(1)`) are rejected explicitly.
- [x] Computed property names and object spread.
- [x] `Object.keys`, `Object.values`, `Object.entries`, `Object.hasOwn`, `Object.assign`, and `Object.fromEntries`.
- [x] `Object.keys` over arrays and tool references.
- [x] Object identity is preserved by in-CodeMode Object helpers.
- [x] Prototype traversal and mutation through `__proto__`, `constructor`, and `prototype` are blocked.
- [ ] Legal own data fields named `__proto__`, `constructor`, or `prototype` are rejected at JSON/tool boundaries and
      cannot be created, read, or written in CodeMode; tool path segments with those names remain supported.
- [x] `Object.is` for supported data values.
- [ ] `Object.groupBy`.

## Arrays

- [x] The `Array` constructor with or without `new`: `Array(a, b)` collects arguments and `Array(n)` creates a sparse
      array of that length; invalid lengths throw `RangeError`. Iteration, spread, join, and JSON handle holes like
      JavaScript, and host results normalize holes to `null`.
- [x] Static methods: `Array.isArray`, `Array.of`, and `Array.from`, including the `Array.from` mapper form with
      `(value, index)` arguments.
- [x] Iteration/transformation: `map`, `filter`, `flatMap`, and `forEach`.
- [x] Searching/tests: `find`, `findIndex`, `findLast`, `findLastIndex`, `some`, `every`, `includes`, `indexOf`, and
      `lastIndexOf`.
- [x] Aggregation: `reduce` and `reduceRight`.
- [x] Ordering: `sort`, `toSorted`, `reverse`, and `toReversed`.
- [x] Access/copying: `at`, `slice`, `concat`, `flat`, `with`, and `join`.
- [x] Mutation: `push`, `pop`, `shift`, `unshift`, `splice`, `fill`, and `copyWithin`.
- [x] Materialized iteration helpers: `keys`, `values`, and `entries` return arrays rather than iterators.
- [x] `length`, numeric indexing, index assignment, spread, and `for...of`.
- [x] The `thisArg` argument of `Array.from` is accepted and ignored, like JS arrows.
- [ ] `Array.prototype.toSpliced`.
- [ ] Canonical array/string index parsing: a key such as `"01"` must remain an ordinary property key rather than
      aliasing index `1`.
- [ ] `Array.prototype.sort` and `toSorted` must preserve trailing holes; they currently turn holes into own
      `undefined` elements.

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
- [ ] Native argument coercion for supported String methods; for example, `includes(1)` and `slice("1")` currently
      reject instead of coercing.
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
- [ ] `++` and `--` must use CodeMode numeric coercion and reject opaque runtime references; they currently call host
      `Number(...)` directly.
- [ ] Unknown static members must read as `undefined` for feature detection; some currently appear callable or throw
      during property access.
- [ ] `Math.sumPrecise`.
- [ ] Global coercing `isFinite` and `isNaN`.

## JSON and console

- [x] `JSON.parse` and `JSON.stringify` for supported data objects; the blocked data-key gap listed above still applies.
- [x] Numeric/string indentation for `JSON.stringify`.
- [x] Captured `console.log`, `console.info`, `console.debug`, `console.warn`, and `console.error`.
- [x] Captured `console.dir` and `console.table`.
- [ ] `JSON.parse` reviver callbacks.
- [ ] `JSON.stringify` function/array replacers.

## Date

- [x] `Date.now`, `Date.parse`, and `Date.UTC`.
- [x] `new Date()` from the current time, epoch milliseconds, a date string, another Date, or local components.
- [x] `Date()` without `new` returns the current time as a string, like JS, but in deterministic ISO format
      rather than the host's locale/timezone string.
- [x] `getTime`, `valueOf`, `toISOString`, `toJSON`, and deterministic ISO `toString`.
- [x] Local getters: `getFullYear`, `getMonth`, `getDate`, `getDay`, `getHours`, `getMinutes`, `getSeconds`, and
      `getMilliseconds`.
- [x] UTC getters: `getUTCFullYear`, `getUTCMonth`, `getUTCDate`, `getUTCDay`, `getUTCHours`, `getUTCMinutes`,
      `getUTCSeconds`, and `getUTCMilliseconds`.
- [x] `getTimezoneOffset`, arithmetic, relational comparison, and `instanceof Date`.
- [x] Date values serialize to ISO strings; invalid dates serialize to `null`.
- [ ] Date setters.
- [ ] `Date.prototype.toUTCString` and its `toGMTString` alias.
- [ ] Native one-argument Date coercion; unsupported boolean/object inputs currently become invalid dates instead of
      being coerced.
- [ ] Native Date loose-equality and default primitive-coercion semantics.
- [ ] Native `RangeError` branding for invalid `toISOString()` calls.

## Regular expressions

- [x] Literal and `RegExp(pattern, flags)` construction, with or without `new`.
- [x] `test`, `exec`, and `toString`.
- [x] Readable `source`, `flags`, `lastIndex`, `global`, `ignoreCase`, `multiline`, `sticky`, `unicode`, and `dotAll`.
- [x] Captures, safe named groups (blocked member names are omitted), match `.index`, and stateful global matching.
- [x] Integration with supported String methods, including function replacers.
- [ ] Writable `lastIndex`.
- [ ] `hasIndices`, match `indices`, and `unicodeSets` metadata for the `d` and `v` flags.
- [ ] `RegExp.escape`.

## Map and Set

- [x] `new Map()` from entry arrays or another Map.
- [x] Map `get`, `set`, `has`, `delete`, `clear`, `size`, and `forEach`.
- [x] `new Set()` from arrays, strings, or another Set.
- [x] Set `add`, `has`, `delete`, `clear`, `size`, and `forEach`.
- [x] Materialized `keys`, `values`, and `entries` arrays for Map and Set.
- [x] Spread, `for...of`, `Array.from`, and `Object.fromEntries` integration.
- [x] Map and Set values serialize to `{}` at host/JSON boundaries.
- [ ] Set composition and relation methods: `union`, `intersection`, `difference`, `symmetricDifference`, `isSubsetOf`,
      `isSupersetOf`, and `isDisjointFrom`.

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
- [x] Catchable user throws, runtime failures raised during interpreted evaluation, awaited tool failures, and awaited
      tool-call-limit failures; parse/compile failures, cooperative timeout, and output bounding remain outside program
      `catch`.
- [x] Source locations on unsupported-syntax diagnostics for JavaScript-shaped input; TypeScript transpilation may
      shift them.
- [x] Sanitized model-visible diagnostics and explicit safe `ToolError` messages.
- [ ] Distinguish user-thrown failures from interpreter defects and explicit tool refusals from sanitized internal tool
      failures; preserve those categories in caught errors, promise rejection handlers, and `Promise.allSettled`
      reasons.
