// The VM itself: conversions, iteration in bytecode, generators. Cases for conformance/streaming.ts (see its
// `holding`, `after` and `during`).
type Helpers = {
  after: (setup: string, work: string) => string
  during: (setup: string, loop: string) => string
  text: unknown
}

// An iterable whose `[Symbol.iterator]`, `next` and `return` are the program's, each calling `S` (see `holding`).
const counting =
  "({ [Symbol.iterator]() { S(0); let n = 0; return { next: () => ({ done: n >= 2, value: S(++n) + n }), return: () => (S(9), {}) } } })"

export default ({ after, text }: Helpers) => ({
  holds: [
    `(() => { const r = []; for (const x of ${counting}) r.push(x); return r })()`,
    `(() => { const r = []; for (const x of ${counting}) { r.push(x); break } return r })()`,
    `(() => { const [a] = ${counting}; return a })()`,
    `(() => { const [a, ...rest] = ${counting}; return [a, rest] })()`,
    `[...${counting}, 7]`,
    `Math.max(...${counting})`,
    `(() => { const it = { i: 0, next() { return { done: this.i > 1, value: S(++this.i) } }, [Symbol.iterator]() { return this } }; const r = []; for (const x of it) r.push(x); return r })()`,
    // A program's valueOf and toString, called by an operator or a built-in.
    `(() => { const o = { valueOf: () => S(1) + 3, toString: () => 'x' + S(2) }; return ['a' + o, o * 2, o < 5, o == 4, \`\${o}\`, -o, ~o] })()`,
    `(() => { const o = { toString: () => 'k' + S(1) }; const m = {}; m[o] = 1; return [m, 'k1' in m, delete m[o], { [o]: 2 }] })()`,
    `(() => { const o = { valueOf: () => S(1) + 2 }; let x = o; x++; let s = 0; for (let i = 0; i < o; i++) s += i; return [x, s] })()`,
    `(() => { const o = { valueOf: () => S(1) + 3, toString: () => 'x' + S(2) }; return ['a'.padStart(o), String(o), Number(o), Math.max(o, 1), [1, 2, 3, 4].slice(o), [o, o].join('-')] })()`,
    `(() => { const d = new Date(0); const r = d.setSeconds({ valueOf: () => (S(1), d.setTime(5000), 7) }); return [r, d.getTime()] })()`,
    `[3, 1, 2].sort((a, b) => ({ valueOf: () => S(a) * 0 + a - b }))`,
    `'abc'.replace('b', () => ({ toString: () => 'X' + S(1) }))`,
    `[{ toLocaleString: () => ({ toString: () => 'T' + S(2) }) }].toLocaleString()`,
    // Inside generators: yield* over the program's iterator, a delegated generator's return() and throw(), for await
    // over a generator, and async generators.
    "(() => { function* g() { yield* { [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n > 1, value: S(++n) }) } } } } return [...g()] })()",
    "(() => { function* inner() { try { yield 1 } finally { S(2) } } function* g() { yield* inner() } const a = g(); a.next(); return a.return(5) })()",
    "(() => { function* inner() { try { yield 1 } catch (e) { yield S(3) } } function* g() { yield* inner() } const a = g(); a.next(); return a.throw(1) })()",
    "await (async () => { const r = []; function* g() { yield S(1); yield 2 } for await (const x of g()) r.push(x); return r })()",
    "await (async () => { async function* ag() { yield* { [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n > 1, value: S(++n) }) } } } } const r = []; for await (const x of ag()) r.push(x); return r })()",
    "await (async () => { async function* ag() { yield S(1); const x = S(2); yield x } const r = []; for await (const x of ag()) r.push(x); return r })()",
    "await (async () => { async function* ag() { yield S(1) } const it = ag(); return [await it.next(), await it.next()] })()",
    // A sync generator's finally, catch and body run under for await and an async generator's yield*.
    "await (async () => { function* g() { try { yield 1; yield 2 } finally { S(9) } } const r = []; for await (const x of g()) { r.push(x); break } return r })()",
    "await (async () => { function* g() { try { yield 1 } catch (e) { yield S(e) } } async function* ag() { yield* g() } const it = ag(); await it.next(); return it.throw(3) })()",
    "await (async () => { function* g() { try { yield 1 } finally { S(4) } } async function* ag() { yield* g() } const it = ag(); await it.next(); return it.return(7) })()",
    "await (async () => { async function* ag() { function* g() { yield S(1); yield S(2) } yield* g() } const r = []; for await (const x of ag()) r.push(x); return r })()",
    // `for await` and an async generator's `yield*` over iterators whose methods are the program's.
    "await (async () => { const r = []; for await (const x of { [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n > 1, value: S(++n) + n }) } } }) r.push(x); return r })()",
    "await (async () => { const r = []; const it = { n: 0, [Symbol.asyncIterator]() { S(0); return this }, next() { return Promise.resolve({ done: this.n > 1, value: S(++this.n) }) } }; for await (const x of it) r.push(x); return r })()",
    "await (async () => { const r = []; const it = { [Symbol.asyncIterator]() { return this }, next: async () => ({ done: false, value: S(1) }), return() { r.push('return ' + S(9)); return { done: true } } }; for await (const x of it) { r.push(x); break } return r })()",
    "await (async () => { const r = []; const src = { [Symbol.iterator]() { let n = 0; return { next: () => ({ done: false, value: S(++n) }), return: () => (r.push('ret ' + S(8)), {}) } } }; for await (const x of src) { r.push(x); break } return r })()",
    "await (async () => { try { for await (const x of { [Symbol.iterator]: () => ({ next: () => { S(1); throw new Error('next threw') } }) }) {} } catch (e) { return e.message } })()",
    "await (async () => { const it = { [Symbol.asyncIterator]() { return this }, next: async () => ({ done: false, value: S(1) }), return: async (v) => ({ done: true, value: S(2) + v }), throw: async (e) => ({ done: false, value: S(3) + e }) }; async function* g() { yield* it } const gen = g(); return [await gen.next(), await gen.throw(10), await gen.return(5), await gen.next()] })()",
  ],
  programs: [
    // Destructuring reads a promise's missing key as undefined, unlike a member read, in every pattern form; a rest
    // and array destructuring still refuse it.
    `const p = Promise.resolve(1); const { a, b = 5, [Symbol.iterator]: it, then } = p; let c; ({ c } = p); const f = ({ d }) => d; const r = []; for (const { e } of [p]) r.push(e); const [{ g }] = [p]; const o = {}; ({ h: o.h } = p); return [a, b, typeof it, typeof then, c, f(p), r, g, o]`,
    `const { a: { b } } = Promise.resolve(1)`,
    `const { a, ...r } = Promise.resolve(1)`,
    `const [x] = Promise.resolve(1)`,
    `for (const [a] of [Promise.resolve(1)]) {}`,
    // Where an uncaught error points: a pattern's property, element, rest and target, ...
    `const { b: { c } } = { b: null }`,
    `const [[a]] = [Promise.resolve(1)]`,
    `let o = null; ({ a: o.x } = { a: 1 })`,
    `const c = 1; [...c] = []`,
    `const c = 1; ({ a: c } = { a: 1 })`,
    `const { [{ toString() { return {} } }]: v } = {}`,
    // ... the for-in right side, a labeled loop, an object spread, ...
    `for (const k in Promise.resolve(1)) {}`,
    `x: y: for (const a of 5) {}`,
    `const o = { a: 1, ...tools.git }`,
    // ... a member's object without parentheses, a namespace path's key and a key that doesn't convert, ...
    `const o = null; return (((o))).a`,
    `const o = Promise.resolve(1); (o).a = 1`,
    `const o = null; delete (o)[0]`,
    `return (tools.git)[(0)]`,
    `tools.git[Symbol.iterator] = 1`,
    `const o = {}; o[{ toString() { return {} } }] += 1`,
    // ... a callee without parentheses, a comparison with a constant, a template's substitution, ...
    `const o = {}; (o.f)()`,
    `return Promise.resolve(1) > 1`,
    `let x = Promise.resolve(1); x += 1`,
    "return `a${(({ toString() { return {} } }))}`",
    // ... and a host call's or import()'s arguments that can't cross.
    `const x = 1; await send({ s: Symbol.iterator })`,
    `let d = []; for (let i = 0; i < 300; i++) d = [d]; const p = send(1, d); await p`,
    `await import("z")`,
    // An update or compound assignment checks the member it writes first, and a computed one before its right side
    // runs or its key converts.
    `tools.a += 1`,
    `tools.a ??= 1`,
    `tools.git[0]++`,
    `const s = "abc"; s.length += 1`,
    `const s = "abc"; s[0] = "x"`,
    `const o = null; o[(() => { console.log("key"); return 1 })()] = console.log("value")`,
    `const o = null; o[{ toString() { console.log("converted"); return "a" } }] += 1`,
    `const p = Promise.resolve(1); p[(() => "k")()] = console.log("value")`,
    `y; let y = 1`,
    // An uncaught value that holds what is not data fails without showing it.
    `throw [tools]`,
    `throw { a: Promise.resolve(1) }`,
    `throw new Map([[1, 2]])`,
    `throw () => 1`,
    `throw new Date(0)`,
    `throw { a: [1, { b: "x" }] }`,
    // The call depth limit's RangeError uncaught, with its location: plain recursion, through a callback, and one
    // level over the exact limit.
    `const f = (n) => f(n + 1); f(1)`,
    `const f = () => [0].map(f); f()`,
    `const r = (n) => (n > 1 ? r(n - 1) : n); r(10000); return r(10001)`,
    `const log = []; function* g() { try { yield 1; yield 2 } finally { log.push('finally'); throw new Error('close') } }
     const r = []; try { for (const x of g()) { r.push(x); break } } catch (e) { r.push(e.message) }
     try { const [a] = g(); r.push(a) } catch (e) { r.push(e.message) }
     try { new Map([[1, 2]].values().map((x) => x)) } catch (e) { r.push(e.message) }
     try { Array.from(g(), (x) => { if (x === 1) throw new Error('mapper') }) } catch (e) { r.push(e.message) }
     return [r, log]`,
    `const it = { [Symbol.iterator]() { return { next: () => ({ done: false, value: 1 }), return: () => 5 } } }
     const r = []; try { for (const x of it) break } catch (e) { r.push(e.message) }
     try { const [a] = it } catch (e) { r.push(e.message) }
     try { for (const x of it) throw new Error('body') } catch (e) { r.push(e.message) }
     try { for (const x of { [Symbol.iterator]: () => ({ next: () => 5 }) }) {} } catch (e) { r.push(e.message) }
     try { [...{ [Symbol.iterator]: () => 5 }] } catch (e) { r.push(e.message) }
     try { for (const x of { [Symbol.iterator]: () => ({}) }) {} } catch (e) { r.push(e.message) }
     return r`,
    // A conversion with no primitive to give, inline, restarted, in an operator and in a step.
    `const o = { valueOf: () => ({}), toString: () => ({}) }; const r = []; for (const f of [() => o + 1, () => 'a'.padStart(o), () => String(o), () => [o].join(), () => Object.groupBy([1], () => o), () => [2, 1].sort(() => o)]) { try { f() } catch (e) { r.push(e.message) } } return r`,
    // Their fuel: the conversions run as calls, a built-in after them again.
    after(
      "const o = { valueOf() { return 1 }, toString() { return 'a' } }",
      "for (let j = 0; j < 300; j++) { o + 1; o < 2; o == 1; `${o}`; [o].join(); 'a'.padStart(o); String(o); Math.max(o, 0); const m = {}; m[o] = 1 }",
    ),
    // `yield*` over a custom iterator and over a generator that gets `return()` and `throw()`, and `for await`: results,
    // errors and closing.
    `const log = []; const it = { i: 0, [Symbol.iterator]() { return this }, next(v) { log.push('next ' + v); return { done: this.i > 1, value: ++this.i } }, return(v) { log.push('return ' + v); return { done: true, value: v * 2 } }, throw(e) { log.push('throw ' + e); return { done: false, value: e + 100 } } }; function* g() { const r = yield* it; log.push('r ' + r); return r } const out = []; for (const x of g()) out.push(x); it.i = 0; const gen = g(); out.push(gen.next(1), gen.next(2), gen.throw(3), gen.return(4), gen.next(5)); return [out, log]`,
    `const log = []; function* inner() { try { yield 1; yield 2 } catch (e) { log.push('caught ' + e); yield 'c' } finally { log.push('inner finally') } return 'done' } function* g() { try { const r = yield* inner(); log.push('r ' + r); yield r } finally { log.push('outer finally') } } const a = g(); const b = g(); const c = g(); return [a.next(), a.return(7), a.next(), b.next(), b.throw(3), b.next(), b.next(), c.return(1), log]`,
    `const log = []; function* inner() { try { yield 1 } finally { log.push('f'); yield 'in finally' } } function* g() { const r = yield* inner(); return r } const a = g(); return [a.next(), a.return(9), a.next(), log]`,
    `function* inner() { try { yield 1 } finally { throw new Error('from finally') } } function* g() { try { yield* inner() } catch (e) { yield 'caught ' + e.message } } const a = g(); a.next(); const b = g(); b.next(); return [a.return(1), a.next(), b.throw(new Error('x'))]`,
    `function* inner() { yield 1 } function* g() { yield* inner() } const a = g(); a.next(); try { a.throw(new Error('uncaught')) } catch (e) { return [e.message, a.next()] }`,
    `const r = []; const bad = (o) => ({ [Symbol.iterator]() { return o } }); function* g(o) { yield* bad(o) } for (const o of [{ next: 5 }, { next: () => 5 }, { next: () => ({ value: 1, done: false }), throw: 5 }, { next: () => ({ value: 1, done: false }), return: () => 5 }, { next: () => ({ value: 1, done: false }) }]) { const it = g(o); try { r.push(it.next()); r.push(it.throw(1)) } catch (e) { r.push(e.message) } try { r.push(it.return(2)) } catch (e) { r.push(e.message) } } return r`,
    `const log = []; const src = { [Symbol.iterator]() { return { next: () => ({ done: false, value: 1 }), return: () => { log.push('closed'); return {} } } } }; async function* g() { return yield* src } const gen = g(); await gen.next(); try { await gen.throw(4) } catch (e) { log.push(e.message) } return log`,
    `const log = []; const src = { [Symbol.iterator]() { return { next: () => ({ done: false, value: 1 }), return: () => 5 } } }; async function* g() { return yield* src } const gen = g(); await gen.next(); try { await gen.throw(4) } catch (e) { log.push(e.message) } return log`,
    `const log = []; const src = { [Symbol.iterator]() { return { next: (v) => ({ done: false, value: 'n' + v }), return: (v) => ({ done: true, value: 'r' + v }), throw: (e) => { throw new Error('t' + e) } } } }; async function* g() { return yield* src } const a = g(); const b = g(); return [await a.next(), await a.next(1), await a.return(2), await b.next(), await b.throw(3).catch((e) => e.message), log]`,
    `const r = []; async function f(src) { try { for await (const x of src) r.push(x) } catch (e) { r.push(e.message) } } await f({ [Symbol.asyncIterator]: () => 5 }); await f({ [Symbol.asyncIterator]: () => ({ next: 5 }) }); await f({ [Symbol.asyncIterator]: 5 }); await f({ [Symbol.iterator]: () => 5 }); await f({ [Symbol.iterator]: () => ({}) }); await f({ [Symbol.iterator]: () => ({ next: () => { throw new Error('next threw') } }) }); await f({ [Symbol.iterator]: () => ({ next: () => 5 }) }); await f({ [Symbol.asyncIterator]: () => ({ next: () => 5 }) }); return r`,
    `const r = []; const it = { [Symbol.asyncIterator]() { return this }, next: () => Promise.resolve({ done: false, value: 1 }), return: () => 5 }; try { for await (const x of it) break } catch (e) { r.push(e.message) } try { for await (const x of it) throw new Error('body') } catch (e) { r.push(e.message) } const sync = { [Symbol.iterator]: () => ({ next: () => ({ done: false, value: Promise.reject(new Error('rejected value')) }), return: () => { r.push('sync closed'); return {} } }) }; try { for await (const x of sync) r.push(x) } catch (e) { r.push(e.message) } return r`,
    `async function* agen() { yield 1; yield 2 } const r = []; const it = { [Symbol.asyncIterator]: agen }; for await (const x of it) r.push(x); for await (const x of { [Symbol.iterator]: function* () { yield 3; yield Promise.resolve(4) } }) r.push(x); return r`,
    // Their fuel.
    after(
      "const mk = () => ({ i: 0, [Symbol.iterator]() { return this }, next() { return { done: this.i++ > 1, value: 1 } }, return: (v) => ({ done: true, value: v }), throw: (e) => ({ done: false, value: e }) }); function* g() { yield* mk() } let closed = 0; function* inner() { try { yield 1 } finally { closed++ } } function* h() { yield* inner() }",
      "for (let j = 0; j < 100; j++) { for (const x of g()) {} const b = h(); b.next(); b.return(3) }",
    ),
    // An abrupt request forwarded by `yield*`.
    after(
      "function* inner() { yield 1 } function* g() { yield* inner() }",
      "for (let j = 0; j < 100; j++) { const a = g(); a.next(); try { a.throw(2) } catch {} }",
    ),
    // A generator method's fifty before the body runs, a delegated method that is missing, bound or caught, and
    // closing what `for await` iterates.
    after(
      "function* g() { yield 1 } function* h() { try { yield 1 } catch { yield 2 } }",
      "for (let j = 0; j < 100; j++) { const a = g(); a.next(); try { a.throw(1) } catch {} const b = h(); b.next(); b.throw(1) }",
    ),
    after(
      "function* g() { yield* [1, 2] } function* inner() { try { yield 1 } catch { yield 2 } } function* h() { yield* inner() }",
      "for (let j = 0; j < 100; j++) { const a = g(); a.next(); a.return(1); const b = g(); b.next(); try { b.throw(1) } catch {} const c = h(); c.next(); c.throw(1); c.next() }",
    ),
    after(
      "const it = { [Symbol.iterator]() { return this } }; it.next = function () { return { done: false, value: 1 } }.bind(it); it.throw = function (e) { return { done: false, value: e } }.bind(it); function* g() { yield* it }",
      "for (let j = 0; j < 100; j++) { const a = g(); a.next(); a.next(); a.throw(1) }",
    ),
    after(
      "async function* ag() { yield 1; yield 2 } function* gen() { yield 1; yield 2 }",
      "for (let j = 0; j < 100; j++) { for await (const x of ag()) break; for await (const x of gen()) break; try { for await (const x of gen()) throw 1 } catch {} }",
    ),
    after(
      "function* inner() { try { yield 1; yield 2 } catch { yield 9 } } async function* g() { yield* inner() }",
      "for (let j = 0; j < 50; j++) { const a = g(); await a.next(); await a.return(3); const b = g(); await b.next(); await b.throw(3); await b.next() }",
    ),
    // Unsupported syntax throws where it runs: code that never reaches it runs, code before it runs, the SyntaxError
    // is catchable, and nested functions holding it are made. A class's name and a var only a `with` body declares
    // are not bindings.
    `if (false) { class A {} } return 1`,
    `console.log(1); class A {}; return 2`,
    `try { class A {} } catch (e) { return [e.name, e.message, e instanceof SyntaxError, Object.keys(e)] }`,
    `return typeof A; class A {}`,
    `return A; class A {}`,
    `class Map {} return typeof Map`,
    `const C = class {}; return 1`,
    `function f() { class A {} } return typeof f`,
    `function f() { return () => { with (x) {} } } return typeof f()`,
    `function f() { return () => { with (x) {} } } f()()`,
    `console.log("a"); with (o) {}`,
    `if (false) with (x) {}; return 1`,
    `return x; with (o) { var x = 1 }`,
    `var y = 2; with (o) { var y = 1 } return y`,
    `L: { class A {} } return 1`,
    `switch (1) { case 2: class A {} } return 1`,
    `switch (1) { case 1: class A {} } return 1`,
    `debugger; return 1`,
    `function f() { return new.target } return 1`,
    `function f() { return new.target } return f()`,
    `return import.meta`,
    `const o = { m() { return super.x } }; return [typeof o.m, (() => { try { o.m() } catch (e) { return e.name } })()]`,
    `const o = { m() { super.x = f() } }; function f() { console.log("f") } return o.m()`,
    `const o = { m() { return super.m(console.log("arg")) } }; return o.m()`,
    `const o = { m() { return delete super.x } }; return o.m()`,
    `const o = { m() { [super.x] = [1] } }; return o.m()`,
    `const { x = class {} } = { x: 1 }; return x`,
    `function f(a = class {}) { return a } return [f(1), (() => { try { f() } catch (e) { return e.name } })()]`,
    `async function f() { await 1; class A {} } return await f().catch((e) => e.name)`,
    `const r = await Promise.allSettled([Promise.resolve().then(() => { class A {} })]); return r[0].reason.name`,
    `const e = (() => { try { class A {} } catch (e) { return e } })(); throw e`,
    `{ export const x = 1 } return 1`,
    `if (true) { export default 1 }`,
    `if (false) { export const y = 1 } return 1`,
    // A using declaration is a const nothing disposes; an import below the top level does nothing in the program and
    // throws where it runs in a function.
    `{ using x = { a: 1 }; await using y = 2; return [x.a, y] }`,
    `{ using x = 1; x = 2 }`,
    `{ import x from "nope" } return typeof x`,
    `function f() { import x from "fs"; return 1 } return typeof f`,
    `function f() { console.log(1); import x from "fs"; return 1 } return f()`,
    `import("fs", { with: { type: "json" } }).then((m) => typeof m)`,
    // A name fails at the name itself, parenthesized or as an assignment target.
    `(x) = 1`,
    `(x) += 1`,
    `const a = 1; (a) = 2`,
    `++(x)`,
    `(y) = 1; let y`,
    // Parse errors in acorn's words and at its positions.
    `return 1 +`,
    `let a; let a;`,
    `function f(a, a) { "use strict" }`,
    `x = { __proto__: 1, "__proto__": 2 }`,
    `const x`,
    `let [a]`,
    `let let = 1`,
    `"use strict"; var yield = 1`,
    `"use strict"; delete x`,
    `"use strict"; 010`,
    `"use strict"; "\\01"`,
    `"use strict"; var eval = 1`,
    `"use strict"; arguments = 1`,
    `var enum = 1`,
    `function f(this) {}`,
    `async function f() { var await }`,
    `function* g() { var yield }`,
    `return /(/`,
    `return /a/gg`,
    `return /a/x`,
    `return /(?<a>.)(?<a>.)/`,
    `return /\\p{Foo}/u`,
    `return /[b-a]/`,
    `return /+/`,
    `return "abc`,
    "return `abc",
    `/* unclosed`,
    `return 1__0`,
    `return 1_`,
    `return 0x_1`,
    `return 0x`,
    `return 1e`,
    `return 3in []`,
    `return 0b2`,
    `return "\\u{110000}"`,
    `return "\\x4"`,
    `({ a = 1 })`,
    `({ get a(x) {} })`,
    `({ set a() {} })`,
    `({ set a(...x) {} })`,
    `x = 1 + (a || b ?? c)`,
    `try {}`,
    `switch (1) { default: default: }`,
    `break`,
    `continue`,
    `L: L: ;`,
    `L: { break M }`,
    `while (1) { continue L }`,
    `L: { continue L }`,
    `function f() { yield 1 }`,
    `() => { await 1 }`,
    `new a?.b()`,
    "a?.b`x`",
    `import.metax`,
    `new.foo`,
    `new.target`,
    `const f = () => new.target`,
    `super.x`,
    `super()`,
    `const o = { m() { super() } }`,
    `var a = 1; let a = 2`,
    `try {} catch ([e, e]) {}`,
    `for (let a of [], b) {}`,
    `for (let x = 1 of []) {}`,
    `for (let x = 1, y of []) {}`,
    `for (async of x) {}`,
    `for (let.x of y) {}`,
    `"use strict"; if (1) function f() {}`,
    `L: function* g() {}`,
    `L: class A {}`,
    `if (1) const x = 1`,
    `if (1) using x = null`,
    `(a, ...b,) => 1`,
    `function f(...a = 1) {}`,
    `let {...{a}} = b`,
    `function f(a = 1) { "use strict" }`,
    `[a] => 1`,
    `({a}) = 1`,
    `a?.b = 1`,
    `"use strict"; with (x) {}`,
    `using x = null`,
    `switch (1) { case 1: using x = 1 }`,
    `{ using x = 1, y }`,
    `let x; [x.#y] = []`,
    `class A { constructor() {} constructor() {} }`,
    `class A { m() { delete this.#a } }`,
    `import()`,
    `import(...a)`,
    `let x: number = 1`,
    `type T = number`,
    `enum E { A }`,
    `const x = <T>1`,
    `const x = y as number`,
    `export const x = 1`,
    `   `,
  ],
  suspensions: [
    // A resumed run reaches unsupported syntax at the same instruction.
    `const n = await wait({}); try { class A {} } catch (e) { return [n, e.name] }`,
    `const o = { valueOf: () => hold({ query: wait({}).then(() => 'echo') }).items.length + 1 }; return [o + 1, 'a'.padStart(o)]`,
    `const r = []; for (const x of { [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n > 1, value: hold({ query: wait({}).then(() => 'echo') }).items.length + ++n }) } } }) r.push(x); return r`,
    // Suspended inside the program's iterator methods called by `for await` and `yield*`.
    `const r = []; for await (const x of { [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n > 1, value: hold({ query: wait({}).then(() => 'echo') }).items.length + ++n }) } } }) r.push(x); return r`,
    `const r = []; for await (const x of { [Symbol.asyncIterator]() { const k = hold({ query: wait({}).then(() => 'echo') }).items.length; let n = 0; return { next: async () => ({ done: n > 1, value: k + ++n }) } } }) r.push(x); return r`,
    `const r = []; for await (const x of { [Symbol.asyncIterator]() { return { next: async () => ({ done: false, value: 1 }), return() { r.push('closed ' + hold({ query: wait({}).then(() => 'echo') }).items.length); return { done: true } } } } }) { r.push(x); break } return r`,
    `const r = []; for await (const x of { [Symbol.iterator]() { return { next: () => ({ done: false, value: 1 }), return() { r.push('closed ' + hold({ query: wait({}).then(() => 'echo') }).items.length); return {} } } } }) { r.push(x); break } return r`,
    ...[
      "const it = { n: 0, [Symbol.iterator]() { return this }, next() { if (this.n === 0) for (let end = Date.now() + 250; Date.now() < end; ) {} return { done: this.n > 1, value: ++this.n } } }; function* g() { yield* it } const r = []; for (const x of g()) r.push(x)",
      "const r = []; function* inner() { try { yield 1 } finally { for (let end = Date.now() + 250; Date.now() < end; ) {} r.push('finally') } } function* g() { return yield* inner() } const a = g(); a.next(); r.push(a.return(5))",
    ].map((work) => `const p = fetch(${JSON.stringify(text)}); ${work}; const res = await p; return [res.status, r]`),
  ],
})
