// The VM itself: conversions, iteration in bytecode, generators. Cases for conformance/streaming.ts (see its
// `searching`, `after` and `during`).
type Helpers = {
  after: (setup: string, work: string) => string
  during: (setup: string, loop: string) => string
  text: unknown
}

// An iterable whose `[Symbol.iterator]`, `next` and `return` are the program's, each calling `S` (see `searching`).
const counting =
  "({ [Symbol.iterator]() { S(0); let n = 0; return { next: () => ({ done: n >= 2, value: S(++n) + n }), return: () => (S(9), {}) } } })"

export default ({ after, text }: Helpers) => ({
  searches: [
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
  ],
  suspensions: [
    `const o = { valueOf: () => search({ query: tools.wait({}).then(() => 'echo') }).items.length + 1 }; return [o + 1, 'a'.padStart(o)]`,
    `const r = []; for (const x of { [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n > 1, value: search({ query: tools.wait({}).then(() => 'echo') }).items.length + ++n }) } } }) r.push(x); return r`,
    // Suspended inside the program's iterator methods called by `for await` and `yield*`.
    `const r = []; for await (const x of { [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n > 1, value: search({ query: tools.wait({}).then(() => 'echo') }).items.length + ++n }) } } }) r.push(x); return r`,
    `const r = []; for await (const x of { [Symbol.asyncIterator]() { const k = search({ query: tools.wait({}).then(() => 'echo') }).items.length; let n = 0; return { next: async () => ({ done: n > 1, value: k + ++n }) } } }) r.push(x); return r`,
    `const r = []; for await (const x of { [Symbol.asyncIterator]() { return { next: async () => ({ done: false, value: 1 }), return() { r.push('closed ' + search({ query: tools.wait({}).then(() => 'echo') }).items.length); return { done: true } } } } }) { r.push(x); break } return r`,
    `const r = []; for await (const x of { [Symbol.iterator]() { return { next: () => ({ done: false, value: 1 }), return() { r.push('closed ' + search({ query: tools.wait({}).then(() => 'echo') }).items.length); return {} } } } }) { r.push(x); break } return r`,
    ...[
      "const it = { n: 0, [Symbol.iterator]() { return this }, next() { if (this.n === 0) for (let i = 0; i < 200000000; i++) {} return { done: this.n > 1, value: ++this.n } } }; function* g() { yield* it } const r = []; for (const x of g()) r.push(x)",
      "const r = []; function* inner() { try { yield 1 } finally { for (let i = 0; i < 200000000; i++) {} r.push('finally') } } function* g() { return yield* inner() } const a = g(); a.next(); r.push(a.return(5))",
    ].map((work) => `const p = fetch(${JSON.stringify(text)}); ${work}; const res = await p; return [res.status, r]`),
  ],
})
