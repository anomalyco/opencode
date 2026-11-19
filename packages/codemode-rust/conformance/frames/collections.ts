// Map, Set, WeakMap, groupBy and the Promise combinators: cases for conformance/streaming.ts (see its `holding`, `after` and `during`).
type Helpers = {
  after: (setup: string, work: string) => string
  during: (setup: string, loop: string) => string
  text: unknown
}

// A Set-like object whose `keys()` steps through `values` with `next`, and may close.
const keysOf = (values: string, extra = "") =>
  `keys() { const v = ${values}; let i = 0; return { next: () => (i < v.length ? { done: false, value: v[i++] } : { done: true }) ${extra} } }`

export default (_: Helpers) => ({
  holds: [
    // The Set methods given a Set-like object: its `has`, its `keys()`, the iterator's `next` and `return`.
    "[...new Set([1, 2, 3]).intersection({ size: 5, has: (x) => S(x) > 0 && x !== 2, keys: () => [].values() })]",
    "[...new Set([1, 2, 3]).difference({ size: 3, has: (x) => S(x) > 0 && x === 2, keys: () => [].values() })]",
    "new Set([1, 2]).isSubsetOf({ size: 2, has: (x) => S(x) > 0, keys: () => [].values() })",
    "new Set([1, 2]).isDisjointFrom({ size: 9, has: (x) => S(x) > 0 && x === 2, keys: () => [].values() })",
    `[...new Set([1]).union({ size: 1, has: () => false, keys: () => { S(0); return [2, 3] } })]`,
    `[...new Set([1, 2]).symmetricDifference({ size: 1, has: () => false, keys() { let n = 0; return { next: () => ({ done: n > 1, value: S(++n) + n }) } } })]`,
    `[...new Set([1, 2]).union({ size: 1, has: () => false, ${keysOf("[S(5), 6]")} })]`,
    `new Set([1]).isDisjointFrom({ size: 0, has: () => true, ${keysOf("[1, 2]", ", return: () => ({ r: S(9) })")} })`,
    `new Set([1, 2]).isSupersetOf({ size: 2, has: () => true, ${keysOf("[1, 7]", ", return() { S(8); return {} }")} })`,
    // getOrInsertComputed, of a Map and of a WeakMap.
    "(() => { const m = new Map([[1, 'a']]); return [m.getOrInsertComputed('k', (k) => S(k) + k), m.getOrInsertComputed(1, () => S(2)), [...m]] })()",
    "(() => { const w = new WeakMap(); const o = {}; return [w.getOrInsertComputed(o, () => S(1) + 1), w.get(o)] })()",
    // WeakMap and WeakSet over an iterable whose `next` calls the program.
    "(() => { const o = {}; const w = new WeakSet({ [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n++ > 0, value: (S(1), o) }) } } }); return w.has(o) })()",
    "(() => { const o = {}; const w = new WeakMap({ [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n++ > 0, value: [o, S(n)] }) } } }); return w.get(o) })()",
    // The combinators over an iterable whose `next` calls the program, and one whose iteration fails.
    "await Promise.all({ [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n > 1, value: S(++n) + n }) } } })",
    "await Promise.allSettled({ [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n > 0, value: Promise.reject(S(++n)) }) } } })",
    "await Promise.race({ [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n > 0, value: S(++n) }) } } })",
    "await Promise.any({ [Symbol.iterator]() { S(1); return [Promise.reject(1), 2].values() } })",
    "await Promise.all({ [Symbol.iterator]() { return { next() { S(1); throw new Error('nx') } } } }).catch((e) => e.message)",
    "await Promise.all({ [Symbol.iterator]() { return { next: () => S(1) } } }).catch((e) => e.message)",
    // A generator's `return` and `throw` called from a callback, and its `next` from native code.
    "(() => { function* g() { try { yield 1 } finally { log.push('finally') } } const it = g(); it.next(); return [1].map((x) => [it.return(S(x)), it.next()]) })()",
    "(() => { function* g() { try { yield 1 } catch (e) { yield e + 1 } } const it = g(); it.next(); return [1].map((x) => [it.throw(S(x)), it.next()]) })()",
    "(() => { function* g() { try { yield 1 } catch (e) { return e } } const it = g(); it.next(); return [1].map((x) => it.throw.call(it, S(x) + x)) })()",
    "Array.from({ [Symbol.iterator]() { const it = (function* () { yield 1; yield 2 })(); return { next: it.next.bind(it), [Symbol.iterator]() { return this } } } }, (x) => S(x) + x)",
    // Object.groupBy's keys converted by the program's toString or valueOf, each right after its callback.
    "Object.groupBy([1, 2], (x) => ({ toString: () => 'g' + S(x) }))",
    "Object.groupBy([1, 2, 3], (x) => ({ toString: () => ({}), valueOf: () => S(x % 2) }))",
    "Object.groupBy({ [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n > 1, value: S(++n) }) } } }, (x) => ({ toString: () => 'k' + S(x) }))",
  ] as Array<string>,
  programs: [
    // Iteration failures and early closes.
    "return [new Set([1]).isDisjointFrom({ size: 0, has: () => true, keys: () => ({ next: () => ({ done: false, value: 1 }), return: () => 1 }) })]",
    "try { new Set([1]).union({ size: 1, has: () => true, keys: () => ({ next: 5 }) }) } catch (e) { return [e.name, e.message] }",
    "try { new Set([1]).union({ size: 1, has: () => true, keys: () => ({ next: () => 5 }) }) } catch (e) { return [e.name, e.message] }",
    "const log = []; function* k() { try { yield 1; yield 2 } finally { log.push('closed') } } return [new Set([1]).isSupersetOf({ size: 1, has: () => true, keys: k }), new Set([1, 5]).isSupersetOf({ size: 2, has: () => true, keys: k }), log]",
    "const log = []; const w = new WeakSet({ [Symbol.iterator]() { return { next: () => ({ done: false, value: 1 }), return() { log.push('closed'); return {} } } } }); return log",
    "try { new WeakSet({ [Symbol.iterator]() { return { next: () => ({ done: false, value: 1 }), return() { return {} } } } }) } catch (e) { return [e.name, e.message] }",
    "try { new WeakMap([[1, 2]]) } catch (e) { return [e.name, e.message] }",
    "return await Promise.race({ [Symbol.iterator]: 5 }).catch((e) => [e.name, e.message])",
    "return await Promise.all({ [Symbol.iterator]() { throw new RangeError('open') } }).catch((e) => [e.name, e.message])",
    "return await Promise.all((function* () { yield 1; yield Promise.resolve(2) })())",
    "function* g() { const x = yield 1; return x * 2 } const it = g(); it.next(); const r = it.next.call(it, 4); let t; try { it.throw.call(it, 1) } catch (e) { t = e } return [r, it.return(7), t]",
    // A generator that throws past a `return` or `throw` request, from a callback and from `yield*` in an async generator.
    "function* g() { try { yield 1 } finally { throw new Error('f') } } const it = g(); it.next(); const r = []; try { [1].map(() => it.return(2)) } catch (e) { r.push(e.message) } function* h() { yield 1 } const j = h(); j.next(); try { [1].forEach(() => j.throw(new Error('t'))) } catch (e) { r.push(e.message) } return [r, j.next()]",
    "function* g() { yield 42; throw new Error('x') } async function* a() { yield* g() } const it = a(); await it.next(); try { await it.throw(new Error('c')) } catch (e) { return [e.message, await it.next()] }",
    "function* k() { try { yield 1 } finally { throw new Error('fin') } } try { new Set([5]).isSupersetOf({ size: 1, has: () => true, keys: k }) } catch (e) { return e.message }",
    // Object.groupBy converts each key right after its callback, and a throwing conversion closes the iterator.
    `const log = []; const r = Object.groupBy(['a', 'b'], (x) => { log.push('cb ' + x); return { toString() { log.push('ts ' + x); return x } } }); return [r, log]`,
    `const log = []; const it = { [Symbol.iterator]() { return { next: () => ({ done: false, value: 1 }), return: () => (log.push('closed'), {}) } } }
     try { Object.groupBy(it, () => ({ toString() { throw new Error('ts') } })) } catch (e) { log.push(e.message) } return log`,
    `return [Object.groupBy([1, 2], (x) => ({ x })), Map.groupBy([1, 2], (x) => ({ toString: () => 'never' })).size]`,
  ] as Array<string>,
  suspensions: [
    // Suspended while a `hold` call parks in a callback these built-ins call.
    `const m = new Map(); const v = m.getOrInsertComputed('k', () => hold({ query: wait({}).then(() => 'echo') }).items.length + 1); return [v, m.get('k')]`,
    `return [...new Set([1, 2]).intersection({ size: 3, has: (x) => hold({ query: wait({}).then(() => 'echo') }).items.length + x > 2, keys: () => [].values() })]`,
    `return await Promise.all({ [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n > 1, value: hold({ query: wait({}).then(() => 'echo') }).items.length + n++ }) } } })`,
    `return Object.groupBy([1, 2], (x) => ({ toString: () => 'g' + (hold({ query: wait({}).then(() => 'echo') }).items.length + x) }))`,
  ] as Array<string>,
})
