// JSON, crossings to the host, strings and the web globals: cases for conformance/streaming.ts (see its `searching`, `after` and `during`).
type Helpers = {
  after: (setup: string, work: string) => string
  during: (setup: string, loop: string) => string
  text: unknown
}

// An iterable whose `next` returns `value` while `n`, which `value` increments, is below 2.
const iterable = (value: string) =>
  `{ [Symbol.iterator]() { let n = 0; return { next: () => (n > 1 ? { done: true } : { done: false, value: ${value} }), return: () => ({}) } } }`
const busy = "for (let i = 0; i < 200000000; i++) {}"

export default ({ after, during, text }: Helpers) => ({
  searches: [
    `Object.fromEntries(${iterable("['k' + n, S(++n)]")})`,
    `new AggregateError(${iterable("S(++n)")}, 'm').errors`,
    `AggregateError(${iterable("S(++n)")}).errors`,
    `Math.sumPrecise(${iterable("S(++n) + 0.5")})`,
    `[...new URLSearchParams(${iterable("['k' + n, S(++n)]")})]`,
    `[...new Headers([${iterable("'v' + S(++n)")}])]`,
    `[...new Headers(${iterable("['x' + n, String(S(++n))]")})]`,
    "({ toString: () => 'x' + S(1) }).toLocaleString()",
  ] as Array<string>,
  programs: [
    // The internal walk: order of toJSON and replacer calls, keys and holders, what is left out, and errors.
    `const log = []; const r = (k, v) => { log.push([k, typeof v]); return k === 'skip' ? undefined : v }
     const v = { a: 1, skip: 2, b: [1, , { toJSON(k) { log.push('toJSON ' + k); return { c: undefined, d: () => 1, e: 'x' } } }], f: undefined }
     return [JSON.stringify(v, r), JSON.stringify(v, r, 2), JSON.stringify(v, r, '--'), log]`,
    `const r = (k, v) => (k === '' ? v : undefined); return [JSON.stringify({ a: 1, b: 2 }, r, 2), JSON.stringify([1, 2], r, 2), JSON.stringify({}, r, 2), JSON.stringify([], r, 2)]`,
    `return [JSON.stringify(5, (k, v) => undefined), JSON.stringify({ a: 1 }, (k, v) => (k ? v + 1 : v)), JSON.stringify('s', (k, v) => [k, v])]`,
    `const a = [1, 2, 3]; return JSON.stringify(a, (k, v) => { if (k === '0') a.length = 1; return v })`,
    `const o = { a: 1, b: 2 }; return JSON.stringify(o, (k, v) => { if (k === 'a') { delete o.b; o.c = 3 } return v })`,
    `const o = { x: 1 }; return [JSON.stringify(o, ['x', 'y'], 1), JSON.stringify({ toJSON: () => ({ y: 2, x: 1 }) }, ['y', 'x']), JSON.stringify([{ x: 1, y: 2 }], ['y'])]`,
    `try { JSON.stringify({ a: { toJSON() { throw new RangeError('tj') } } }) } catch (e) { return [e.name, e.message] }`,
    `try { JSON.stringify([1, [2]], (k, v) => { if (v === 2) throw new TypeError('r'); return v }) } catch (e) { return [e.name, e.message] }`,
    `const o = { a: 1 }; try { JSON.stringify(o, (k, v) => (k === 'a' ? o : v)) } catch (e) { return [e.name, e.message] }`,
    `return JSON.stringify({ p: 1, q: [2] }, (k, v) => (k === 'p' || k === '0' ? Promise.resolve(1) : v))`,
    `const log = []; try { JSON.stringify({ a: 1, p: Promise.resolve(1) }, (k, v) => { log.push(k); return v }) } catch (e) { return [e.name, e.message, log] }`,
    `try { return JSON.stringify([Promise.resolve(1)]) } catch (e) { return [e.name, e.message] }`,
    `const e = new Error('m'); e.name = undefined; const f = new TypeError('n'); f.name = 5; f.x = 1; return JSON.stringify({ e, f }, (k, v) => v, 1)`,
    `return [JSON.stringify({ a: Symbol.iterator, b: [Symbol.iterator] }, (k, v) => v), JSON.stringify({ s: Symbol.iterator }, ['s'], 1)]`,
    `const p = Object.create({ inh: 1 }); p.own = 2; p.gone = 3; return JSON.stringify({ p }, (k, v) => { if (k === 'own') delete p.gone; return v })`,
    `const a = [1, 2, 3]; return JSON.stringify(a, (k, v) => { if (k === '0') a[2] = 'changed'; return v })`,
    `let d = 1; for (let i = 0; i < 99; i++) d = [d]; return [JSON.stringify(d, (k, v) => v).length, JSON.stringify({ d }, (k, v) => v).length]`,
    `const big = 'x'.repeat(1 << 20); const parts = Array(600).fill(big); try { JSON.stringify(parts, (k, v) => v) } catch (e) { return [e.name, e.message] }`,
    `const log = []; const s = JSON.stringify({ e: new TypeError('m'), d: new Date(0), m: new Map([[1, 2]]), s: new Set([1]), u: new URL('https://a.b/c') }, (k, v) => { log.push(k); return v }, '\\t'); return [s, log]`,
    `const seen = []; JSON.stringify({ a: [1, { b: 2 }] }, function (k, v) { seen.push([k, Array.isArray(this) ? 'array' : typeof this]); return v }); return seen`,
    // A replacer or toJSON that calls back into JSON.stringify.
    `return JSON.stringify({ a: { b: 1 }, c: [2] }, (k, v) => (k === 'a' ? JSON.stringify(v, (k2, v2) => v2) : v))`,
    `return JSON.stringify({ a: { toJSON: () => JSON.stringify({ x: { toJSON: () => 1 } }) } }, null, 1)`,
    // The other built-ins of this family, over custom iterables.
    `const log = []; const it = { [Symbol.iterator]() { let n = 0; return { next() { log.push('next'); return n < 2 ? { done: false, value: n++ === 0 ? ['a', 1] : 5 } : { done: true } }, return() { log.push('return'); return {} } } } }
     try { Object.fromEntries(it) } catch (e) { log.push(e.message) } return log`,
    `const log = []; const it = { [Symbol.iterator]() { let n = 0; return { next() { log.push('next'); return n < 2 ? { done: false, value: n++ ? 'x' : 1 } : { done: true } }, return() { log.push('return'); return {} } } } }
     try { Math.sumPrecise(it) } catch (e) { log.push(e.message) } return [log, Math.sumPrecise([0.1, 0.2, -0.3]), Math.sumPrecise([])]`,
    `const log = []; const pair = { [Symbol.iterator]() { let n = 0; return { next() { log.push('part'); return n < 2 ? { done: false, value: n++ ? { toString() { throw new Error('part') } } : 'k' } : { done: true } }, return() { log.push('close pair'); return {} } } } }
     const outer = { [Symbol.iterator]() { let n = 0; return { next() { log.push('pair'); return n++ < 2 ? { done: false, value: pair } : { done: true } }, return() { log.push('close'); return {} } } } }
     try { new URLSearchParams(outer) } catch (e) { log.push(e.message) } return log`,
    `const g = function* () { yield ['a', '1']; yield new Set(['b', 2]) }; return [String(new URLSearchParams(g())), [...new Headers(g())], [...new Headers(new Map([['x', 'y']]))]]`,
    `try { new Headers([['a', 'b', 'c']]) } catch (e) { return [e.name, e.message] }`,
    `try { new URLSearchParams([1]) } catch (e) { return [e.name, e.message] }`,
    `const e = new AggregateError(new Set([1, new Error('x')]), 'all', { cause: 2 }); return [e.errors.length, e.message, e.cause, AggregateError([]).errors]`,
    `try { new AggregateError(5) } catch (e) { return [e.name, e.message] }`,
    `try { Object.fromEntries(5) } catch (e) { return [e.name, e.message] }`,
    `try { Math.sumPrecise(5) } catch (e) { return [e.name, e.message] }`,
    `try { AggregateError({}) } catch (e) { return [e.name, e.message] }`,
    `return [({}).toLocaleString(), Object.prototype.toLocaleString.call(5), Object.prototype.toLocaleString.call([1, [2]])]`,
    `try { return Object.prototype.toLocaleString.call({ toString: 7 }) } catch (e) { return [e.name, e.message] }`,
    `const t = Promise.prototype.then; const log = []; Promise.prototype.then = function (f, r) { log.push('then'); return t.call(this, f, r) }
     const n = await search({ query: 'echo' }).then((r) => r.items.length); Promise.prototype.then = t; return [n > 0, log]`,
    `const r = search({ query: 'echo' }); return [await r.catch(() => 0) === r, await r.finally(5) !== r, (await r.finally(() => 1)).items.length > 0]`,
    // Busy loops in the walk's callbacks: its fuel decides when the reference starts the queued read.
    during("const doc = { a: [1, { b: 2 }], c: 'x', d: { toJSON: () => see(3) } }", "for (let j = 0; j < 300; j++) { JSON.stringify(doc, (k, v) => see(v), 1); JSON.stringify(doc, ['a', 'b', 'c']); see(j) }"),
    during("const it = () => ({ [Symbol.iterator]() { let n = 0; return { next: () => (n < 3 ? { done: false, value: ['k' + n, see(n++)] } : { done: true }) } } })",
      "for (let j = 0; j < 300; j++) { Object.fromEntries(it()); new URLSearchParams(it()); new Headers(it()); Math.sumPrecise(new Set([1, 2])); new AggregateError(it()); see(j) }"),
    after("", "for (let j = 0; j < 37; j++) Object.fromEntries([['a', j]])"),
    after("", "for (let j = 0; j < 37; j++) new AggregateError([j])"),
    after("", "for (let j = 0; j < 37; j++) Math.sumPrecise([j, 1])"),
    after("", "for (let j = 0; j < 37; j++) ({}).toLocaleString()"),
    after("", "for (let j = 0; j < 37; j++) { new URLSearchParams([['a', 'b']]); new Headers([['a', 'b']]) }"),
    after("", "for (let j = 0; j < 37; j++) JSON.stringify({ a: [j, { b: 2 }] }, (k, v) => v, 1)"),
  ] as Array<string>,
  suspensions: [
    `const p = fetch(${JSON.stringify(text)}); const s = JSON.stringify({ a: [1, { toJSON() { ${busy} return 2 } }], b: 'x' }, null, 1); const r = await p; return [r.status, s]`,
    `const p = fetch(${JSON.stringify(text)}); const s = JSON.stringify({ a: [1, 2], b: { c: 3 } }, (k, v) => { if (k === 'c') { ${busy} } return v }); const r = await p; return [r.status, s]`,
    `const p = fetch(${JSON.stringify(text)}); const o = Object.fromEntries(${iterable(`(n++ ? (() => { ${busy} return ['b', n] })() : ['a', n])`)}); const r = await p; return [r.status, o]`,
    `const p = fetch(${JSON.stringify(text)}); const h = new Headers([${iterable(`(n++ ? (() => { ${busy} return 'v' })() : 'k')`)}]); const r = await p; return [r.status, [...h]]`,
    `const p = fetch(${JSON.stringify(text)}); const s = ({ toString() { ${busy} return 's' } }).toLocaleString(); const r = await p; return [r.status, s]`,
  ] as Array<string>,
})
