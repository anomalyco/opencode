# CodeMode Interpreter Support

This is the checkable support matrix for CodeMode's confined JavaScript interpreter. It tracks the language and
standard-library surface that programs can use today, plus concrete gaps that may be implemented later.

- `[x]` means the feature is implemented at the scope described here.
- `[ ]` means a concrete compatibility gap remains.
- Checked items do not promise complete ECMAScript edge-case parity; known differences are stated explicitly.
- Intentional boundaries are not listed as compatibility work.

When behavior changes, update this file and the tests in the same change. The implementation and tests remain the
ultimate source of truth. Upstream test262 files run verbatim from `test/test262`; a failing file is listed in
`test/test262/skipped.txt` and its gap is an unchecked item here (see `test/test262/README.md`).

## Source and execution model

- [x] JavaScript parsed with the latest syntax accepted by Acorn, then restricted by the interpreter allowlist.
      TypeScript-only syntax is rejected rather than stripped before execution.
- [x] Top-level `await` and `return` through the program's implicit async-function scope.
- [x] Explicit `return`, final top-level expression as a REPL-style result, and `null` when no value is produced.
- [x] The host boundary is `JSON.stringify` plus a short table. The program result and tool arguments cross as
      what `JSON.stringify` would serialize: `toJSON` is honored, functions and `undefined` properties vanish,
      `undefined` array elements and non-finite numbers become `null`, a cyclic value throws the same `TypeError`,
      and Map, RegExp, and generators serialize as `{}`. A bare `undefined` result is `null`.
      Tool results come back the way `JSON.parse(JSON.stringify(result))` would. The table, where a value cannot
      be JSON but what the program meant is clear: a promise is awaited (a rejection fails the program), a Set
      crosses as an array, a URLSearchParams as its query string, an Error as `{ name, message, ...own enumerable }`, a
      Uint8Array is rejected with a hint to encode as text, and own `__proto__` keys are dropped so merging tool
      inputs or results cannot replace a prototype. In-program `JSON.stringify` keeps JS behavior except for the
      Error form and a promise, which is a `TypeError` with an await hint rather than a silent `{}`.
- [x] Live Date, RegExp, Map, Set, URL, URLSearchParams, Headers, and Uint8Array values inside CodeMode.
- [x] Tool calls through the host-provided `tools` tree only.
- [x] The global `search(...)` built-in: synchronous tool discovery that counts as an admitted tool call and is
      shadowable by program declarations like other globals.
- [x] Cooperative timeout, an optional total tool-call limit, output bounding, and unrestricted tool-call concurrency.
- [x] The timeout fires between interpreter steps, so one built-in is bounded in what it may build: strings up to
      2^24 characters (`repeat`, `pad*`, `concat`, `join`, `+`, template literals, `JSON.stringify`), arrays up to
      10,000,000 elements (`Array(n)`, `length =`, `Array.from`, `split`, `matchAll`, `concat`, `flat`; below the JS
      maximum of 2^32 - 1), and 10,000 pending promises at once. Exceeding one throws a `RangeError`. A single regular
      expression match can still run long on a pathological pattern; the host regex engine has no interrupt hook.
- [x] A trailing comma after a rest parameter is a syntax error, with or without `"use strict"`.
- [x] A program that begins with `"use strict"` rejects `yield` as an identifier and duplicate parameter names at
      parse time. Without it, `yield` is an ordinary binding.
- [x] Duplicate parameter names in non-strict code bind the last parameter, as in JS (`function f(a, a)` called
      with `(1, 2)` sees `a === 2`).

## Values and literals

- [x] `null`, `undefined`, booleans, finite and non-finite numbers, and strings.
- [x] Array literals, including holes and spread from arrays, strings, Maps, Sets, URLSearchParams, Headers, custom
      synchronous iterators, and synchronous generators.
- [x] Object literals with shorthand, computed string/number keys, and spread following ToObject: data objects and
      arrays copy own enumerable keys, strings copy index keys, and other values contribute nothing.
- [x] Template literals with interpolation.
- [x] Tagged templates: a tag applied to a template literal is called as `tag(strings, ...values)`, with the tag read
      like a callee so a member tag keeps its receiver. `strings` is an array of the cooked text with a read-only `raw`
      array of the source text; an invalid escape such as `\unicode` cooks to `undefined`. One template object per
      site, as in JS, but it is not frozen: `strings[0] = "x"` succeeds here where JS throws.
- [x] Regular-expression literals.
- [x] `NaN` and `Infinity` globals.
- [ ] BigInt literals and in-interpreter BigInt arithmetic; BigInt remains invalid at JSON-like host boundaries.
- [ ] Arbitrary Symbol primitive values and symbol-keyed properties. The confined `Symbol.iterator` and
      `Symbol.asyncIterator` keys are available only for the iterator protocols.
- [ ] Getter and setter definitions in object literals.

## Bindings and destructuring

- [x] `const`, `let`, and `var` declarations.
- [x] Object and array destructuring in declarations, parameters, assignment expressions, and `for...of` bindings.
- [x] Nested patterns, defaults, elisions, and rest elements.
- [x] Assignment to identifiers, plain-object fields, non-negative integer array indexes, and writable URL
      fields.
- [x] Direct function declarations are hoisted in program and block statement lists.
- [x] Parameter defaults observe a temporal dead zone for later parameters.
- [x] `var` is function-scoped and hoisted: names declared anywhere in a function or program body, including loop
      heads, blocks, `switch` cases, and `try`/`catch`, read as `undefined` before their statement runs; redeclaration
      assigns the one binding; a same-named parameter keeps its argument; closures in parameter defaults see outer
      names rather than body `var`s.
- [x] Predeclare `let` and `const` bindings in every lexical scope, including program/block bodies, switch bodies, and
      loop headers, so reads before initialization and self- or cross-referential initializers observe the JavaScript
      temporal dead zone.
- [x] Function declarations are hoisted across all cases of a `switch`, like any other statement list.
- [x] Computed object destructuring keys such as `const { [field]: value } = record`.
- [x] Object destructuring from arrays, such as `const { length } = values`.
- [x] Array binding and assignment destructuring from strings, Maps, Sets, URLSearchParams, custom synchronous
      iterators, and synchronous generators, including stepwise elisions/rest and `IteratorClose` on early completion
      or binding/default failure.
- [x] Object destructuring from primitives follows ToObject: `const { length } = "abc"` is `3`, `const { toFixed } = 1`
      finds the built-in, `const {} = 1` is a no-op, and a rest element copies a string's indexes (`{ 1: "y", 2: "z" }`).
      Only `null` and `undefined` sources throw (`Cannot destructure null as it is null.`).
- [x] Destructuring reads through the prototype chain like member access: `const { constructor } = error` and
      `const { slice } = values` find the inherited built-in.
- [x] Any assignment target as a `for...in` head, like `for...of`: `for (x.y in obj)`, `for (a[i++] in obj)`, and
      destructuring patterns.

## Statements and control flow

- [x] Blocks and empty statements.
- [x] `if`/`else` and conditional expressions.
- [x] `switch`, including default clauses and fallthrough.
- [x] `for`, `while`, and `do...while`.
- [x] `for...of` over arrays, strings, Maps, Sets, URLSearchParams, Headers, Uint8Arrays, built-in iterators, custom
      synchronous iterators, and confined synchronous generators. Abrupt completion invokes the iterator's optional `return()`.
- [x] `for...in` over own keys of plain objects, arrays, strings, and tool references. `null`, `undefined`, and other
      non-objects iterate nothing. An un-awaited promise throws rather than iterating.
- [ ] `for...in` over inherited enumerable keys (`Object.create(proto)`), and skipping keys deleted during the loop.
- [x] Unlabeled `break` and `continue`.
- [x] `try`, `catch`, optional catch bindings, and `finally`.
- [x] `throw` with arbitrary values.
- [x] Labeled statements, labeled `break`, and labeled `continue`.
- [x] `for await...of` over the supported synchronous collections and custom iterator objects using
      `Symbol.asyncIterator` or the `Symbol.iterator` fallback. Each iterator step is sequential, yielded promises and
      plain values from synchronous collections and sync iterators are awaited before binding, and abrupt loop
      completion invokes the iterator's optional `return()`. Custom async iterators control their yielded values, as in
      JavaScript; only their `next()` results are awaited. Confined sync and async generators are iterable here.

## Functions and callbacks

- [x] Function declarations, function expressions, and arrow functions.
- [x] Synchronous and `async` functions. A line break between `function` and the name is allowed, as in JavaScript;
      a line break between `async` and `function` is not an async function.
- [x] Closures, recursion, default parameters, rest parameters, and destructured parameters.
- [x] A call depth limit of 10000: deeper nesting throws a catchable `RangeError: Maximum call stack size exceeded`
      at the overflowing call instead of running until the timeout. Callbacks invoked by built-ins count below the
      call that invoked the built-in, and a resumed `await` starts from depth 0 as in JS, so long async chains such
      as recursive pagination are unaffected.
- [x] Expression and block function bodies.
- [x] User callbacks for the supported Array, Map, Set, URLSearchParams, sort, string-replacement, and `Array.from`
      mapper APIs, with one shared acceptance rule everywhere including promise reactions.
- [x] `Boolean`, `Number`, `String`, `parseInt`, `parseFloat`, `isFinite`, `isNaN`, and URI helpers as callbacks.
- [x] Built-in method references as callbacks, such as `values.map(Math.abs)`, `records.map(JSON.stringify)`,
      `items.forEach(console.log)`, and `Promise.resolve(-1).then(Math.abs)`. Extra callback arguments a built-in
      does not consume are ignored, like JS, and consumed arguments coerce, like JS (`"3.7".replace(/\d\.\d/,
  Math.floor)` is `"3"`). A detached method loses its receiver, as in JS: `values.filter("abc".includes)` is a `TypeError`
      because `includes` is called without a string `this`.
- [x] Constructors work as callbacks with JS call semantics: `Error` types construct (`messages.map(Error)`),
      and new-requiring constructors (`Map`, `Set`, `URL`, `URLSearchParams`, `Headers`, `Promise`) throw a `TypeError`,
      like JS.
- [x] Tool references and detached `Promise` statics are rejected as callbacks with a hint to wrap them in an
      arrow function.
- [x] Promise-returning string replacers are coerced synchronously to `"[object Promise]"`, like JavaScript; they are
      not automatically awaited.
- [x] `this` in non-arrow functions is the call's receiver: `obj.m()` and `obj["m"]()` see `obj`, a bare or detached
      call (`f()`, `const m = obj.m; m()`, `(0, obj.m)()`) sees `undefined`, as in strict JS. Arrows read the enclosing
      function's `this`. Program code has no receiver, so top-level `this` is `undefined`, as in a module.
- [x] `arguments` in non-arrow functions: an unmapped ordinary object with the call's arguments as indexed
      properties and a hidden `length`; iterable, so spread, `for...of`, and `Array.from` work. It is not an Array
      (`JSON.stringify` gives `{"0":1}`, `String` gives `[object Arguments]`). A parameter named `arguments` shadows
      it; arrows read the enclosing function's; it is only created for functions whose body mentions it. `callee`
      and `caller` are absent rather than poisoned.
- [ ] Array methods on `arguments` and other array-likes (`Array.prototype.slice.call(arguments, 1)`); use
      `[...arguments]` or a rest parameter meanwhile.
- [x] `Function.prototype.call`, `apply`, and `bind` on program functions and built-ins:
      `Array.prototype.push.call(arr, 1)`, `Math.max.apply(null, values)`, `fn.bind(obj, first)`. `apply` accepts an
      array, an array-like object (its `length` clamped and capped like `Array.from`), or `null`/`undefined`. A
      bound function is named `bound f`, has its remaining `length`, and is not constructible.
- [x] `JSON.parse` revivers and `JSON.stringify` function replacers see the holder object as `this`.
- [x] The optional `thisArg` of the Array, Uint8Array, and `Array.from` callback methods and of Map, Set,
      URLSearchParams, and Headers `forEach` is the callback's `this`: `[1, 2].forEach(function () { this.n++ }, c)`
      increments `c.n` twice. Arrows ignore it, as in JS; `reduce`/`reduceRight` take an initial value instead.
- [ ] User-defined constructor calls.
- [ ] Classes and private fields.
- [x] Functions are objects: they hold own properties (`fn.count = 1`), enumerate them, and expose read-only `name`
      and `length`. Names follow JavaScript's NamedEvaluation: declarations, named expressions, bindings,
      assignments, object literal keys, and destructuring or parameter defaults.
- [x] Built-in functions are objects too, with `name` and `length` (`Math.max.length === 2`,
      `Array.prototype.push.name === "push"`).
- [x] A named function expression's name is bound read-only inside its own body; assigning to it throws a
      `TypeError`, as in strict mode.
- [x] Redeclaring a function in the same scope, or alongside a `var`, is allowed: the last declaration wins.
- [x] Generator functions have their own `prototype` (inheriting the shared generator prototype), so
      `g() instanceof g` holds. Plain functions have none, since they cannot construct.
- [ ] `GeneratorFunction.prototype`: every function, generator or not, inherits directly from `Function.prototype`,
      and a generator whose `prototype` was replaced by a non-object still creates from the shared generator prototype.
- [x] Generator and async generator functions bind parameters (defaults, destructuring) at the call and defer only the
      body to the first `next()`, so a bad argument throws synchronously from the call site, as in JS.
- [x] Synchronous and async generator declarations/expressions, `yield`, and `yield*`, including lazy bodies,
      `next(value)`, `return(value)`, `throw(value)`, exhaustion, promise adoption, async request ordering,
      `try`/`catch`/`finally`, and sync/async iterator symbols. Async `yield*` awaits values while adapting a sync
      iterator but preserves values supplied by a manually implemented async iterator. Generator values are opaque
      runtime references.
- [x] Synchronous generators and custom synchronous iterators are consumed stepwise by array/argument spread, array
      destructuring, `Array.from`, Map/Set/URLSearchParams construction, `Object.fromEntries`, Object/Map `groupBy`,
      Promise combinators, `AggregateError`, and `Math.sumPrecise`. Mapper/grouping callbacks interleave with iterator
      steps; synchronous consumers preserve yielded promise objects rather than awaiting them. Async generators are
      rejected by every synchronous consumer.
- [x] Synchronous iterator acquisition and result validation follow `IteratorClose` boundaries: consumer errors and
      intentional early stops invoke `return()`, acquisition/`next()` failures do not, and an original consumer error
      wins over a cleanup failure. A generator's `return()` is an intentional stop, so a `return()` that throws or
      yields a non-object surfaces from it as a `TypeError`. Async iterator consumption remains limited to `for await...of` and async `yield*`.
- [x] Portable generator protocol coverage is adapted from pinned Test262 cases for suspended-start, suspended-yield,
      and completed states; sync and async `next`/`return`/`throw`; finally yields and completion overrides; rejected
      yielded promises; mixed async request queues; sync and async `yield*` forwarding; malformed methods/results;
      and declaration, expression, and object-method forms with closure and parameter behavior. The adapted suite
      deliberately skips Test262 variants whose observation mechanism requires unsupported getter definitions,
      proxies, prototype inspection or mutation, classes, or arbitrary symbols. It also skips tests
      asserting exact promise reaction-turn counts beyond the observable ordering guarantee documented below. These
      are interpreter-surface boundaries, not claims that the corresponding full Test262 families pass unchanged.

## Expressions and operators

- [x] Property access with dot or computed bracket syntax.
- [x] Optional property access and optional calls.
- [x] Function/tool calls and spread arguments.
- [x] Sequence expressions (the comma operator).
- [x] `await` for CodeMode promises and callable thenables; a plain value passes through unchanged, though every
      `await` still defers its continuation one reaction turn.
- [x] `new` for Array, Object, Error types, Date, RegExp, Map, Set, URL, URLSearchParams, Headers, and Promise. `new`
      on any other value throws a catchable `TypeError` naming the callee: other built-in functions such as `Number`
      say `new` is unsupported and point at the plain call, user-defined functions report the constructor gap below,
      and non-callable values are not constructors. Error constructors take the ES2022 options object, so
      `new Error(message, { cause })` installs a non-enumerable `cause` when the option is present. `Error.isError`
      is true for every Error value.
- [x] Arithmetic operators: `+`, `-`, `*`, `/`, `%`, and `**`.
- [x] Equality and ordering: `==`, `!=`, `===`, `!==`, `<`, `<=`, `>`, and `>=`.
- [x] Bitwise operators: `&`, `|`, `^`, `~`, `<<`, `>>`, and `>>>`.
- [x] Logical operators: `&&`, `||`, `??`, and `!`, with short-circuiting.
- [x] Unary `+`, unary `-`, `void`, `typeof`, `instanceof` (through the constructor's `prototype`, so
      `[] instanceof Object` holds), and `in` across the prototype chain.
- [x] Prefix and postfix `++` and `--`.
- [x] Plain, arithmetic, bitwise, and logical assignment operators.
- [x] Property deletion on plain data objects and arrays, including computed and optional forms; deleting an array index
      creates a hole without changing its length. Deleting a non-configurable property (`length`) or
      assigning a read-only one (`Math.PI`, `fn.name`) throws a `TypeError`, as in strict mode. `delete` of a
      non-reference (`delete 0`, `delete f()`) evaluates the operand and is `true`; `delete x` on a variable throws.
- [x] Coercion helpers and template interpolation accept functions and namespaces: `String(fn)` and `${fn}` give
      `"[object Function]"` rather than the source text, `isNaN(fn)` is `true`.
- [x] `==` and `!=` follow IsLooselyEqual: objects (including functions and tool references) compare by identity, a
      nullish operand never coerces the other side, and a data object facing a primitive converts through its own
      `valueOf`/`toString` (default hint) (`fn == null` is `false`, `fn == fn` is `true`, `[1] == 1` and `[1, 2] == "1,2"` are `true`).
      `switch` matches cases with `===`, so `switch (fn) { case fn: }` selects, and `Object.is` compares any two
      values. Operators inspect only their direct operands, so `rows == null` on a large array costs the same as
      `rows === null`, and an object merely holding a function inside (`[fn] + ""`, `-[fn]`) coerces like any other
      data object (`"[object Function]"`, `NaN`).
- [ ] Coercing a function, promise, generator, or tool reference itself: `fn + ""`, `-fn`, `fn++`, and `fn == 1`
      throw `TypeError: Binary operators require data values.` (or the unary/update form) where JavaScript would use
      the source text or `NaN`.
- [x] ToPrimitive on program objects: `+ - * / % **`, the relational and bitwise operators, unary `+ - ~`, `++`/`--`,
      compound assignment, `${x}`, `Number`/`String`/`isNaN`/`isFinite`, `parseInt`/`parseFloat` (text and radix),
      `Math.*` arguments, `Error(message)`, and `Array.prototype.join`/`toString` elements call the object's own
      `valueOf`/`toString` in spec order (both operands left then right, `+` with the default hint) and surface their
      throws: `{ valueOf() { return 7 } } * 2` is `14`, `` `${{ toString() { return "x" } }}` `` is `"x"`, and
      `[1, 2]` with `arr.toString = () => "x"` makes `arr + ""` `"x"`. Dates keep their `Symbol.toPrimitive`
      behavior (`date + 1` concatenates, `date - date` subtracts).
- [ ] ToPrimitive elsewhere: `Error.prototype.toString` on an object `message` and numeric built-in arguments outside
      `Math` and `Date` (`at`, `indexOf` start, `toFixed` digits) still use the built-in form (`NaN`,
      `"[object Object]"`) and ignore own methods.
- [x] Property keys follow ToPropertyKey: `x[null]`, `x[true]`, and objects (via their built-in string form) become
      string keys.

## Promises and tools

- [x] Tool calls start eagerly and return supervised, run-once CodeMode promises.
- [x] Direct `await`, repeated awaits, and recursive thenable assimilation when a promise or thenable is returned from
      a function/program.
- [x] `Promise.resolve` and `Promise.reject`.
- [x] `Promise.all`, `Promise.allSettled`, `Promise.race`, and `Promise.any` over finite collections, custom synchronous
      iterators, and synchronous generators containing promises and plain values.
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
      throw rejects unless the promise already settled, resolving with a promise or callable thenable adopts it, and
      resolving with the promise itself rejects with a `TypeError`. Resolver callables work anywhere callbacks are
      accepted, including `.then`/`.catch` handlers and collection callbacks, and vanish at the data boundary like
      any function.
- [x] `Promise.withResolvers()`: the same promise and resolver callables as the constructor, as a `{ promise, resolve,
reject }` object.
- [x] `Promise.try(fn, ...args)`: calls `fn` synchronously; a throw rejects, a return fulfils, and a returned promise or
      thenable is adopted.
- [x] Recursive assimilation of objects with an own callable `then` field across `Promise.resolve`, combinators,
      constructors, reactions, `finally`, `await`, and async returns. Thenable methods run deferred, receive
      first-call-wins resolve/reject functions, and ignore throws after settlement. Inherited/accessor `then` fields
      remain outside the supported object model.
- [x] Dotted tool names are canonicalized into namespace paths; a path can be both callable and a namespace, and the
      last tool supplied for a canonical path wins.
- [x] Tool path segments may be named `constructor`, `prototype`, or `__proto__` because paths use inert Map keys.
- [x] Outbound tool arguments are what `JSON.stringify` would serialize (see the boundary rule above). Tools never
      receive `undefined` inside their input object, though a bare `tools.t(undefined)` argument still reaches schema
      decoding as `undefined`.
- [ ] Tokenize and case-fold non-ASCII tool paths, descriptions, and queries for tool search.

## Objects and properties

- [x] Own-field reads and writes on plain data objects.
- [x] `new` dispatches on the evaluated constructor value, so aliases (`const D = Date; new D()`), constructors held in
      objects, and constructors passed as arguments work, while a shadowed name (`const Date = 5; new Date()`) does
      not construct.
- [x] `Object()` and `new Object()` return `{}` for nullish arguments and pass objects through unchanged;
      primitive wrapper objects (`Object(1)`) are rejected explicitly.
- [x] Computed property names and object spread. Any value works as a key (ToPropertyKey): strings, numbers, and the
      two confined symbols as themselves, everything else as its string form (`o[null]` is `o["null"]`, `o[{}]` is
      `o["[object Object]"]`), in reads, writes, literals, `in`, and destructuring.
- [x] `Object.keys`, `Object.values`, `Object.entries`, `Object.hasOwn`, `Object.assign`, and `Object.fromEntries`, with
      synchronous iterator support for `fromEntries`. Sources follow ToObject: strings enumerate by index, other
      primitives and wrappers contribute nothing, and `null`/`undefined` throw. `Object.assign` accepts array
      targets for index keys only; a primitive target is a `TypeError` rather than a boxed object.
- [x] `Object.keys` over arrays and tool references.
- [x] Object identity is preserved by in-CodeMode Object helpers.
- [x] Every value has a real prototype chain built fresh for each run: `Object.prototype`, `Array.prototype`,
      `String.prototype`, `Error.prototype` → `TypeError.prototype`, and so on hold the built-in methods as
      non-enumerable properties, and each constructor's `prototype` points at it (`[].constructor === Array`,
      `Object.getPrototypeOf([]) === Array.prototype`). Programs may read and even overwrite these prototypes; the
      change is confined to that run. `__proto__` is an ordinary own data key, so `o.__proto__ = x` never changes the
      chain, and `Object.groupBy` results have no prototype at all, as in JS.
- [x] `Object.getPrototypeOf`: the prototype of an object, or the built-in prototype for a string, number, or boolean
      (`Object.getPrototypeOf("a") === String.prototype`); `null`, `undefined`, and the two confined symbols throw a
      `TypeError`.
- [x] `Object.create(proto)` with an object or `null` prototype; any other prototype is a `TypeError`
      (`Object prototype may only be an Object or null`). Inherited reads, `in`, `hasOwnProperty`, and own-only
      `Object.keys` follow the chain as in JS, but `for...in` still enumerates own keys only. A second `properties`
      argument other than `undefined` throws a `TypeError`: property descriptors are not supported (there is no
      `Object.defineProperty` either).
- [x] `Object.freeze`, `Object.seal`, and `Object.preventExtensions`, with `isFrozen`, `isSealed`, and `isExtensible`.
      Each returns its argument and passes primitives through (`Object.freeze(1) === 1`, `Object.isFrozen(1)`).
      Programs run as strict code, so violations throw `TypeError`: `Cannot assign to read only property 'a'`,
      `Cannot add property b, object is not extensible`, and `Cannot delete property 'a'`. Arrays enforce the same
      rules for index writes, `length`, and the mutating methods (`Object.freeze([1]).push(2)` throws; a sealed array's
      `pop()` throws; a non-extensible array's `pop()`, `sort()`, and `splice(0, 1, x)` work). The mutating methods are
      checked once up front, so a `fill` or `sort` that would land on a hole of a non-extensible array succeeds here
      where JS throws. Maps, Sets, and Dates freeze their properties only, not their contents, as in JS.
      `Object.freeze(new Uint8Array(1))` and `seal` throw `TypeError` like JS (`preventExtensions` and empty typed
      arrays are fine). Functions are objects and freeze like any other value.
- [x] Circular references are rejected when created (`o.self = o`, `array.push(array)`), not at serialization as in JS.
- [x] `Object.is` for supported data values.
- [x] `Object.groupBy` over finite collections and custom synchronous iterators/generators, with string-key coercion
      and plain-object results.
- [x] `Object.prototype` methods on values: `toString` (`"[object Array]"`, `"[object Map]"`, `"[object Promise]"`, and so
      on for every built-in kind, as JS reports through `Symbol.toStringTag`), `toLocaleString` (calls the value's
      `toString`, as in JS), `valueOf`, `hasOwnProperty`, `isPrototypeOf`, and `propertyIsEnumerable`.

## Arrays

- [x] The `Array` constructor with or without `new`: `Array(a, b)` collects arguments and `Array(n)` creates a sparse
      array of that length; invalid lengths throw `RangeError`. Iteration, spread, join, and JSON handle holes like
      JavaScript, and host results normalize holes to `null`.
- [x] Static methods: `Array.isArray`, `Array.of`, and `Array.from`, including the `Array.from` mapper form with
      `(value, index)` arguments and stepwise synchronous iterator consumption.
- [x] Iteration/transformation: `map`, `filter`, `flatMap`, and `forEach`.
- [x] Searching/tests: `find`, `findIndex`, `findLast`, `findLastIndex`, `some`, `every`, `includes`, `indexOf`, and
      `lastIndexOf`. An explicit `undefined` fromIndex counts as present: `[1, 2, 1].lastIndexOf(1, undefined)` is `0`
      while `lastIndexOf(1)` is `2`.
- [x] Aggregation: `reduce` and `reduceRight`.
- [x] Ordering: `sort`, `toSorted`, `reverse`, and `toReversed`.
- [x] Access/copying: `at`, `slice`, `concat`, `flat`, `with`, `join`, and `toLocaleString` (each element's
      `toLocaleString`, holes and nullish elements as empty strings).
- [x] Mutation: `push`, `pop`, `shift`, `unshift`, `splice`, `fill`, and `copyWithin`.
- [x] `keys`, `values`, `entries`, and `[Symbol.iterator]` (the same function as `values`) return live iterator objects
      with `next()` and `[Symbol.iterator]`, as in JS. Iterator objects are opaque references: they print as
      `[opaque reference]`, serialize to `{}`, and cannot be passed to extensions. Every built-in collection iterator
      shares one prototype, where JavaScript gives each collection its own; `Object.getPrototypeOf` shows the
      difference.
- [x] `length`, numeric indexing, index assignment, spread, and `for...of`.
- [x] `Array.prototype.toSpliced`.
- [x] Canonical array/string index parsing: keys such as `"01"` are ordinary properties rather than aliases of index
      `1`.
- [x] `Array.prototype.sort` preserves trailing holes, while `toSorted` densifies holes into `undefined` elements,
      like JavaScript.
- [x] Assigning `length` to truncate or extend an array; invalid lengths throw `RangeError`.
- [x] Non-index own properties on arrays (`arr.foo = 1`, `arr.constructor = null`). They are excluded from the JSON
      form, like `JSON.stringify`.
- [x] Numeric arguments coerce as in JS (ToIntegerOrInfinity): `indexOf(x, "1")`, `slice("1", "3")`, `at(null)`,
      `flat(1.9)`, `with(1.5, v)`, `Math.max("3", "2")`, `parseInt("11", "2")`, `(1.5).toFixed("2")`,
      `String.fromCharCode("65")`, and the Uint8Array equivalents. `join(sep)` and `JSON.parse(text)` apply ToString
      (`join(null)` is `"1null2"`, `JSON.parse(123)` is `123`). `Array.from({ length: "2" })` applies ToLength; a
      promise source still throws with an `await` hint rather than JS's silent `[]`. `join`, `Math.*`, and
      `parseInt` consult a program object's own `valueOf`/`toString`; the array and number methods do not yet (see
      ToPrimitive above).

## Strings

- [x] Case/normalization: `toLowerCase`, `toUpperCase`, `normalize`, and the `toLocaleLowerCase`/`toLocaleUpperCase`
      aliases, which ignore their locale argument and apply the default Unicode casing.
- [x] Trimming: `trim`, `trimStart`, and `trimEnd`, plus the Annex B `trimLeft` and `trimRight` aliases.
- [x] Searching/tests: `includes`, `startsWith`, `endsWith`, `indexOf`, `lastIndexOf`, and `search`.
- [x] Slicing/access: `slice`, `substring`, Annex B `substr`, `at`, `charAt`, `charCodeAt`, and `codePointAt`.
- [x] Construction/transformation: `split`, `concat`, `repeat`, `padStart`, `padEnd`, `replace`, and `replaceAll`.
- [x] Regular-expression integration: `match`, materialized `matchAll`, `replace`, `replaceAll`, `split`, and `search`.
- [x] `localeCompare`; locale and options arguments are currently ignored.
- [x] `isWellFormed` and `toWellFormed`.
- [x] `toString`, `length`, numeric indexing, spread, `for...of`, and `[Symbol.iterator]` by Unicode code point.
- [x] Static `String.fromCharCode` and `String.fromCodePoint`.
- [x] Native argument coercion for supported String methods; for example, `includes(1)` and `slice("1")` coerce like
      native JS, `split(undefined)` returns the whole string, and `includes`/`startsWith`/`endsWith` reject regular
      expressions with a native-style `TypeError`. Opaque runtime references still reject as data errors, and
      `repeat` still requires a finite non-negative count.
- [x] Native no-argument parity for `match()`, `matchAll()`, and `search()`; all behave as an empty pattern.
- [x] `String.raw`, on a template object or any `{ raw }` object; raw strings and substitutions coerce through their own
      `toString`.
- [x] `match`, `matchAll`, `search`, and `split` read any non-RegExp argument as a pattern string, as `new RegExp(arg)`
      would: `"a1b".match(1)` matches `/1/`, `search(null)` looks for `"null"`, and `undefined` is the empty pattern.
      Objects use their built-in string form until ToPrimitive lands.

## Numbers and Math

- [x] Coercion functions: `Number`, `parseInt`, and `parseFloat`.
- [x] Number predicates/parsers: `Number.isInteger`, `Number.isFinite`, `Number.isNaN`, `Number.isSafeInteger`,
      `Number.parseInt`, and `Number.parseFloat`.
- [x] Number formatting: `toFixed`, `toPrecision`, `toExponential`, `toString`, `valueOf`, and `toLocaleString`, which
      always formats as `en-US` (`"1,234.5"`) so output does not depend on the host.
- [x] Number constants: `MAX_SAFE_INTEGER`, `MIN_SAFE_INTEGER`, `MAX_VALUE`, `MIN_VALUE`, `EPSILON`, `NaN`,
      `POSITIVE_INFINITY`, and `NEGATIVE_INFINITY`.
- [x] Math constants: `PI`, `E`, `LN2`, `LN10`, `LOG2E`, `LOG10E`, `SQRT2`, and `SQRT1_2`.
- [x] Math methods: `random`, `max`, `min`, `abs`, `acos`, `acosh`, `asin`, `asinh`, `atan`, `atan2`, `atanh`,
      `floor`, `ceil`, `round`, `trunc`, `sign`, `sqrt`, `cbrt`, `pow`, `hypot`, `cos`, `cosh`, `sin`, `sinh`,
      `tan`, `tanh`, `log`, `log2`, `log10`, `log1p`, `exp`, `expm1`, `f16round`, `fround`, `clz32`, and `imul`.
- [x] Native zero-argument behavior for `Number()` and `String()`: they produce `0` and `""`, while
      `Number(undefined)` stays `NaN` and `String(undefined)` stays `"undefined"`.
- [x] `++` and `--` use CodeMode numeric coercion (numeric strings increment, plain data objects become `NaN`, Dates
      use their epoch time) and reject opaque runtime references as data errors.
- [x] Unknown static members on global namespaces and on `Number`/`String`/the coercion functions read as `undefined`
      for feature detection. Calling any undefined value reports a native-style `TypeError` naming the callee, for
      example `Math.sum is not a function.` or `search(...).catch is not a function.` Unknown `Promise` statics keep
      their descriptive error.
- [x] `Math.sumPrecise` over finite collections and custom synchronous iterators/generators, rejecting non-number
      elements without coercion.
- [x] Global coercing `isFinite` and `isNaN`; opaque runtime references reject as data errors, like `Number(...)`.

## JSON and console

- [x] `JSON.parse` and `JSON.stringify` for supported data objects.
- [x] Numeric/string indentation for `JSON.stringify`.
- [x] `JSON.parse` reviver callbacks, including postorder traversal, deletion through `undefined`, and root replacement.
      Revivers receive `(key, value)` with the holder as `this`.
- [x] `JSON.stringify` function and array replacers. Function replacers receive `(key, value)` in preorder, including
      the root, with the holder as `this`. Array replacers preserve requested property order, deduplicate names, coerce
      number primitives, and ignore non-string/non-number entries. Primitive wrapper entries remain unsupported.
- [x] Captured `console.log`, `console.info`, `console.debug`, `console.warn`, and `console.error`. An Error prints as
      `Error.prototype.toString` would show it (`Error: boom`), wherever it appears in the logged value.
- [x] Captured `console.dir` and `console.table`.

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
- [x] Local and UTC Date setters, including native argument coercion, mutation, rollover, invalid-Date recovery, and
      `TimeClip` behavior. On an invalid Date every setter but `setTime` and `set(UTC)FullYear` answers `NaN` without
      writing, so a time set inside an argument's `valueOf` survives.
- [x] `Date.prototype.toUTCString` and its `toGMTString` alias.
- [x] `toDateString` and `toTimeString` in the host's local timezone.
- [x] `toLocaleString`, `toLocaleDateString`, and `toLocaleTimeString` always format as `en-US` in UTC
      (`"1/1/1970, 12:00:00 AM"`) so output does not depend on the host.
- [x] Native one-argument Date coercion for supported values, including booleans, null, arrays, and plain objects.
- [x] Date setters, construction, and `Date.UTC` coerce object arguments through their own `valueOf`/`toString` in
      argument order and surface their throws; only the first seven components are converted.
- [x] Native Date loose-equality and default primitive-coercion semantics, using CodeMode's deterministic ISO string
      representation for the string primitive.
- [x] Native `RangeError` branding for invalid `toISOString()` calls.

## Regular expressions

- [x] Literal and `RegExp(pattern, flags)` construction, with or without `new`.
- [x] `test`, `exec`, and `toString`.
- [x] Readable `source`, `flags`, `lastIndex`, `hasIndices`, `global`, `ignoreCase`, `multiline`, `sticky`, `unicode`,
      `unicodeSets`, and `dotAll`.
- [x] Captures, named groups, match `.index` and `.input`, and stateful global matching.
- [x] Integration with supported String methods, including function replacers.
- [x] Writable `lastIndex`, shared by `exec`, `test`, and the String methods. It is a prototype accessor that stores
      a number, so `re.lastIndex = "12"` reads back `12`, `delete` is a no-op, and `hasOwnProperty("lastIndex")` is
      `false`.
- [x] Match `indices` metadata for the `d` flag, including named groups on `exec`, `match`, and `matchAll` results.
- [x] `RegExp.escape`.

## Iterator

- [x] `Iterator.prototype.map`, `filter`, `take`, `drop`, and `flatMap` on any iterator or generator: lazy, one source
      step per result, closing the source when a callback throws, on early `return()`, or when `for...of` or
      destructuring finishes with it early. Once done or closed a helper stays done, and a callback that re-enters its
      own helper is a `TypeError`. `take`/`drop` coerce their count and reject `NaN` or negative counts with a
      `RangeError`; `flatMap` callbacks must return an iterable or iterator, not a string.
- [x] `Iterator.prototype.reduce`, `toArray`, `forEach`, `some`, `every`, and `find`, closing the source on early exit.
- [x] `Iterator.from(value)` returns iterators and generators as they are, and wraps strings, iterables, and objects
      with a `next` method. `Iterator` itself is abstract: calling or constructing it is a `TypeError`.
- [x] Helpers and `Iterator.from` wrappers have `return()`; collection iterators (`array.values()`) do not, as in JS,
      so an early exit from them leaves them where they were.
- [ ] `Iterator.concat`, `Iterator.zip`, and `Iterator.zipKeyed` (stage 3 proposals).

## Map and Set

- [x] Static `Map.groupBy` over finite collections and custom synchronous iterators/generators, preserving key identity.
- [x] `new Map()` from synchronous iterables of entries.
- [x] Map `get`, `set`, `has`, `delete`, `clear`, `size`, `forEach`, `getOrInsert`, and `getOrInsertComputed`.
      `forEach` is live: entries deleted during the walk are skipped and entries added are visited, as in JS.
- [x] `new Set()` from synchronous iterables.
- [x] Set `add`, `has`, `delete`, `clear`, `size`, and `forEach`.
- [x] Live `keys`, `values`, `entries`, and `[Symbol.iterator]` iterators for Map and Set; a Set-like operand's `keys()`
      may return any iterator or an array.
- [x] Spread, `for...of`, `Array.from`, and `Object.fromEntries` integration.
- [x] Map and Set values serialize to `{}` at host/JSON boundaries.
- [x] Set composition and relation methods: `union`, `intersection`, `difference`, `symmetricDifference`, `isSubsetOf`,
      `isSupersetOf`, and `isDisjointFrom`, including supported Set-like operands.

## URL and URI helpers

- [x] `encodeURI`, `encodeURIComponent`, `decodeURI`, and `decodeURIComponent`.
- [x] `new URL(input, base)`, `URL.canParse`, and `URL.parse`.
- [x] URL `toString`, `toJSON`, and linked `searchParams`.
- [x] Readable URL fields: `href`, `origin`, `protocol`, `username`, `password`, `host`, `hostname`, `port`,
      `pathname`, `search`, and `hash`.
- [x] Writable URL fields except `origin`.
- [x] `new URLSearchParams()` from query strings, data objects, synchronous iterables of pairs, and URLSearchParams.
- [x] URLSearchParams `append`, `delete`, `get`, `getAll`, `has`, `set`, `sort`, `forEach`, `keys`, `values`,
      `entries`, `[Symbol.iterator]`, `toString`, and `size`.
- [x] URL values are their href in `JSON.stringify` and at the host boundary. URLSearchParams are `{}` in
      `JSON.stringify` and their query string at the host boundary.

## Uint8Array

The only binary type. Bytes stay inside the program or cross to extensions as copies; the tool boundary rejects them
with a hint to encode as text first (`TextDecoder`, `toBase64`, `toHex`).

- [x] `new Uint8Array(length | array | iterable | Uint8Array)`, `Uint8Array.from`, `Uint8Array.of`, `fromBase64`,
      and `fromHex`. Lengths are capped like arrays.
- [x] Index reads and writes with JS byte semantics: values wrap modulo 256, out-of-range writes are ignored, indexes
      cannot be deleted. `length` is a prototype accessor, so `Object.keys` lists only indexes.
- [x] `at`, `slice`, `subarray` (a view on the same bytes), `set`, `fill`, `reverse`, `indexOf`, `lastIndexOf`,
      `includes`, `join`, `toString`, `toBase64`, `toHex`, and live `keys`, `values`, `entries`, and `[Symbol.iterator]`
      iterators. Start indexes coerce as for arrays, and `lastIndexOf(x, undefined)` searches from index 0 while
      `lastIndexOf(x)` searches from the end, as in JS.
- [x] Spread, destructuring, `for...of`, `yield*`, `Array.from`, and `new Set(bytes)`. `Array.isArray` is false.
- [x] String coercion joins with commas; `JSON.stringify` gives `{"0":1,...}`; `console.log` prints
      `Uint8Array(n) [...]`.
- [x] Callback methods `forEach`, `map`, `filter`, `find`, `findIndex`, `findLast`, `findLastIndex`, `some`, `every`,
      `reduce`, and `reduceRight`, sharing the Array implementations; the callback receives `(byte, index, bytes)`.
      `map` and `filter` return new Uint8Arrays with results clamped like index writes (`map((b) => b * 100)` on
      `[1, 2, 3]` is `[100, 200, 44]`); `reduce` on an empty Uint8Array without an initial value is a `TypeError`.
- [x] `sort` in place, numeric ascending by default (`[10, 9, 1]` sorts to `[1, 9, 10]`) or by comparator.
- [ ] `ArrayBuffer`, `DataView`, and other typed arrays.

## Web platform helpers

- [x] `atob` and `btoa` with forgiving-base64 decoding and WebIDL string conversion; invalid input throws a
      `TypeError`, since there is no `DOMException`.
- [x] `crypto.randomUUID()` and `crypto.getRandomValues(uint8Array)`.
- [x] `structuredClone(value)` deep-copies primitives, plain objects (own enumerable string keys onto a plain object;
      the prototype is not kept), arrays (holes and extra keys kept), Map, Set, Date, RegExp (`lastIndex` reset to 0),
      Uint8Array, and errors (standard `name`, `message`, `cause`, and `stack`; other names become `Error`, extra
      fields drop). Shared references stay shared in the copy, and the copy is extensible even when the source was
      frozen. Functions, symbols, promises, iterators, URL, Headers, and tool references cannot be cloned; without a
      `DOMException`, the failure is a `TypeError` whose message starts with `DataCloneError:`.
- [x] `TextEncoder` and `TextDecoder` for UTF-8 only: any other label is a `RangeError`. `TextDecoder` accepts the
      `fatal` and `ignoreBOM` options; `decode` takes a Uint8Array or nothing.
- [x] `new Headers()` from records, synchronous iterables of pairs, and Headers, wrapping the host's `Headers`: names
      fold to lowercase, values are normalized and combined, and invalid names or values throw a `TypeError`.
- [x] Headers `append`, `delete`, `get`, `getSetCookie`, `has`, `set`, `forEach`, `keys`, `values`, `entries`, and
      `[Symbol.iterator]`; iteration is live and sorted by name, with `set-cookie` values kept apart.
- [x] Headers serialize to a `{ name: value }` object in JSON, in results, and in tool arguments.
- [ ] `Request`, `Response`, and `Blob`.
- [ ] `crypto.subtle` and `TextDecoder` streaming or non-UTF-8 encodings.

## Extensions

Host functions a host opts in through `Extension.make({ name, globals })` and `CodeMode.make({ extensions })`.
Nothing is exposed unless a host provides it; extension calls are not tool calls.

- [x] Each global is a function, callable but not constructible, run with `this` undefined. A global that shadows
      a built-in or another extension throws at `make`.
- [x] Every value crossing in either direction is converted, never shared: plain objects and arrays are copied,
      `Date`, `RegExp`, `URL`, `URLSearchParams`, `Headers`, `Map`, `Set`, and `Uint8Array` become fresh copies with
      their contents converted (a host `ArrayBuffer` comes in as a `Uint8Array`; other typed arrays cannot come out),
      errors cross as errors with their name, message, `cause`, and own enumerable data, and a `__proto__` key is
      dropped. Functions, generators,
      un-awaited promises, and symbols cannot be passed in; a class instance, a symbol, or a BigInt cannot come out.
- [x] A host function inside a result becomes a program function whose calls cross the same way, so a result can
      carry methods (`res.json()`) whose host closures keep the host state. Diagnostics name it by its path
      (`fetch.json`). Like any program function it vanishes at the data boundary.
- [x] Each call to an extension global runs inside the host's `extension.before`/`extension.after` hooks as
      `{ extension, name, args }`, with the host's own error on failure; calls to functions inside results do not.
- [x] A host `Promise` becomes a program promise. Whatever host code returns, resolves, throws, or rejects with
      crosses the same way, so `catch (e)` receives a copy of the thrown value (an `Error` of the matching type, or
      plain data).
- [x] An Error crosses, in either direction, as its name, message, `cause`, and own enumerable data, so Node's
      `code`, `errno`, `syscall`, and `path` reach the program and `err.code === "ENOENT"` works. `stack` stays on its
      own side, no field may shadow an Error method, and a field that cannot cross (a class instance, a function) is
      left behind rather than replacing the error.
- [ ] Program functions as arguments to extension code (callbacks such as `forEach`).
- [ ] Host classes. Stateful host objects are expressed as closures; a declared method table would be the next
      step if `new X()` in a program is ever needed.

## Errors and diagnostics

- [x] `Error`, `TypeError`, `RangeError`, `SyntaxError`, `ReferenceError`, `EvalError`, and `URIError`, callable with
      or without `new`.
- [x] `AggregateError` with the `(errors, message?)` signature and an own `errors` array, constructed directly or by
      an all-rejected `Promise.any`; direct construction accepts custom synchronous iterators and generators.
- [x] Error `name`/`message`, error inheritance through `instanceof`, and plain-data serialization. `message` is an own
      non-enumerable property and `name` is inherited, as in JS, so `Object.keys(err)` is `[]` for a plain error. The
      result boundary still emits `{ name, message, ...own enumerable }`, so a field such as `code` crosses. `cause` is
      non-enumerable: an extension Error carries it, and this JSON form does not. Errors have no `stack`; the diagnostic
      carries a 1-based line and column in the submitted source instead.
- [x] `instanceof` against any constructor with a `prototype`, including every built-in and `Function`.
- [x] Derived error constructors extend `Error` itself: `Object.getPrototypeOf(TypeError) === Error`, so
      `TypeError.isError` is inherited, and `TypeError.prototype` inherits from `Error.prototype`.
- [x] Catchable user throws, runtime failures raised during interpreted evaluation, awaited tool failures, and awaited
      tool-call-limit failures; parse/compile failures, cooperative timeout, and output bounding remain outside program
      `catch`.
- [x] Source locations on unsupported-syntax diagnostics. The diagnostic names the rejected node type and attaches a
      short orientation to the supported subset; this matrix is the full reference.
- [x] Model-visible host failure messages and underlying causes, including output-validation errors.
- [x] Caught errors do not distinguish user throws, interpreter failures, and tool failures; a program sees one
      Error-shaped value in `catch`, rejection handlers, and `Promise.allSettled` reasons. It always has `name` and
      `message`, plus `cause` and own data when the failure carried them. This is deliberate: the program should
      handle a failure the same way regardless of where it originated.
- [x] Failures raised by the interpreter are `TypeError`s unless JavaScript names them otherwise (`RangeError`,
      `ReferenceError`, `SyntaxError`, `URIError`), so `e instanceof TypeError` and `e.constructor === TypeError`
      hold. Unsupported syntax reached at runtime is a `SyntaxError`; awaited tool failures stay plain `Error`.
      Host errors escaping a built-in (`(1).toFixed(200)`) become the same-named program error at the call.
      A failure raised inside a promise a built-in created (`Promise.all(1)`, `Promise.race([])`, a resolution cycle)
      is located at the call that created the promise.
- [x] One failure is one error object: every `catch`, rejection handler, and `allSettled` reason for the same
      failure sees the identical value, so `a === b` holds after awaiting the same rejected promise twice.
- [x] Rethrowing an interpreter failure keeps its diagnostic: `catch (e) { throw e }` still reports the original
      kind and source location. Uncaught errors report as `name: message` whoever raised them, as
      `Error.prototype.toString` would (`TypeError: Cannot read properties of null (reading 'foo').`,
      `TypeError: bad input`); other thrown values report as `Uncaught: <value>`.
