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
    // A search inside a toJSON while values cross: tool arguments, search input.
    "await tools.search({ query: { toJSON: () => 'echo' + S(1) } }).then((r) => r.items.length)",
    "search({ query: { toJSON: () => 'echo' + S(1) } }).items.length",
    "await tools.t.echo({ a: { toJSON: () => S(1) }, p: Promise.resolve(2) })",
    `Object.fromEntries(${iterable("['k' + n, S(++n)]")})`,
    `new AggregateError(${iterable("S(++n)")}, 'm').errors`,
    `AggregateError(${iterable("S(++n)")}).errors`,
    `Math.sumPrecise(${iterable("S(++n) + 0.5")})`,
    `[...new URLSearchParams(${iterable("['k' + n, S(++n)]")})]`,
    `[...new Headers([${iterable("'v' + S(++n)")}])]`,
    `[...new Headers(${iterable("['x' + n, String(S(++n))]")})]`,
    "({ toString: () => 'x' + S(1) }).toLocaleString()",
    // A search whose walk calls a toJSON, then awaits: its frame parks with the search's.
    "search({ query: { toJSON: () => 'echo' }, p: Promise.resolve(1) }).items.length",
    "search({ p: Promise.resolve(1), query: { toJSON: () => 'echo' } }).items.length",
    "[1, 2].map((x) => search({ query: { toJSON() { log.push('tj ' + x); return 'echo' } }, p: Promise.resolve(x) }).items.length + x)",
    "(() => { try { search({ query: { toJSON: () => 'echo' }, p: Promise.reject(new Error('no')) }) } catch (e) { return [e.name, e.message] } })()",
    "(() => { try { search({ p: Promise.resolve(1), query: { toJSON() { throw new Error('tj') } } }) } catch (e) { return [e.name, e.message] } })()",
    "await Promise.resolve(1).then((x) => search({ query: { toJSON: () => 'echo' }, p: Promise.resolve(x) }).items.length + x)",
    // A key or part converted by the program's toString or valueOf inside the loop over the entries or pairs.
    // An entry holding a function is rejected, so a key's methods are inherited.
    "Object.fromEntries([[Object.create({ toString: () => 'k' + S(1) }), 1], ['b', 2]])",
    "Object.fromEntries([[Object.create({ toString: () => ({}), valueOf: () => S(3) }), 'v']])",
    `Object.fromEntries(${iterable("[Object.create({ toString: () => 'k' + S(++n) }), n]")})`,
    "[...new URLSearchParams([[{ toString: () => 'a' + S(1) }, 'b'], ['c', { toString: () => 'd' + S(2) }]])]",
    "[...new Headers([[{ toString: () => 'x-' + S(1) }, { toString: () => 'v' + S(2) }]])]",
    `[...new URLSearchParams(${iterable("[{ toString: () => 'k' + S(++n) }, n]")})]`,
  ] as Array<string>,
  programs: [
    // A search inside a toJSON of the program's result.
    `const log = []; return { t: { toJSON: () => (log.push('call'), search({ query: Promise.resolve('echo') }).items.length) }, log }`,
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
    // A toJSON a crossing to the host calls runs in the crossing's frame: its jobs, what it returns and throws.
    `const log = []; const p = tools.t.echo({ p: Promise.resolve(1), t: { toJSON() { log.push('tj'); Promise.resolve().then(() => log.push('then')); return 1 } } })
     Promise.resolve().then(() => log.push('job')); log.push('after'); const r = await p; return [r, log]`,
    `const log = []; Promise.resolve().then(() => log.push('job')); return { t: { toJSON() { log.push('tj'); Promise.resolve().then(() => log.push('then')); return 1 } }, p: Promise.resolve(1), log }`,
    `Date.prototype.toJSON = () => 'mine'; return [await tools.t.echo({ d: new Date(0) }), await tools.t.echo({ d: new Date(0), p: Promise.resolve(1) })]`,
    `URL.prototype.toJSON = () => 'mine'; return [await tools.t.echo({ u: new URL('https://a.b/c') }), await tools.t.echo({ u: new URL('https://a.b/c'), p: Promise.resolve(1) })]`,
    `return search({ query: { toJSON: () => 'echo' }, p: Promise.reject(new Error('no')) }).items.length`,
    `return search({ query: { toJSON: () => 'echo' }, p: Promise.resolve(1), q: { toJSON() { null.x } } }).items.length`,
    `return [{ toJSON: () => 'echo' }].map((q) => search.call(null, { query: q }).items.length)`,
    `return await tools.t.echo({ a: { toJSON: Object.prototype.toString }, p: Promise.resolve(1) })`,
    `return await tools.t.echo({ a: { toJSON: () => tools.t.echo(1) } })`,
    `const t = { toJSON(k) { return { k, n: { toJSON: (k2) => k2 + '!' } } } }; return [await tools.t.echo({ t, u: [t] }), await tools.t.echo({ t, p: Promise.resolve(1) }), search({ query: 'echo', t }).items.length]`,
    `return [{ t: { toJSON() { return Promise.resolve(5) } } }, await tools.t.echo({ t: { toJSON() { return Promise.resolve(5) } } })]`,
    `try { return [{ toJSON: () => 'echo' }].map((q) => search.call(null, { query: q, p: Promise.resolve(1) }).items.length) } catch (e) { return [e.name, e.message] }`,
    // A key or part whose conversion throws closes the iterator; the order of the conversions against the reads.
    `const log = []; const it = { [Symbol.iterator]() { return { next: () => ({ done: false, value: [Object.create({ toString() { throw new Error('ts') } }), 1] }), return: () => (log.push('closed'), {}) } } }
     try { Object.fromEntries(it) } catch (e) { log.push(e.message) } return log`,
    `const log = []; const it = { [Symbol.iterator]() { return { next: () => ({ done: false, value: [{ toString() { throw new Error('ts') } }, 'v'] }), return: () => (log.push('closed'), {}) } } }
     try { new URLSearchParams(it) } catch (e) { log.push(e.message) } try { new Headers(it) } catch (e) { log.push(e.message) } return log`,
    `const log = []; const key = (k) => Object.create({ toString() { log.push('ts ' + k); return k } }); const it = { [Symbol.iterator]() { let n = 0; return { next() { log.push('next ' + n); return n < 2 ? { done: false, value: [key('k' + n), n++] } : { done: true } } } } }
     return [Object.fromEntries(it), String(new URLSearchParams(it)), log]`,
  ] as Array<string>,
  suspensions: [
    `const p = fetch(${JSON.stringify(text)}); const s = JSON.stringify({ a: [1, { toJSON() { ${busy} return 2 } }], b: 'x' }, null, 1); const r = await p; return [r.status, s]`,
    `const p = fetch(${JSON.stringify(text)}); const s = JSON.stringify({ a: [1, 2], b: { c: 3 } }, (k, v) => { if (k === 'c') { ${busy} } return v }); const r = await p; return [r.status, s]`,
    `const p = fetch(${JSON.stringify(text)}); const o = Object.fromEntries(${iterable(`(n++ ? (() => { ${busy} return ['b', n] })() : ['a', n])`)}); const r = await p; return [r.status, o]`,
    `const p = fetch(${JSON.stringify(text)}); const h = new Headers([${iterable(`(n++ ? (() => { ${busy} return 'v' })() : 'k')`)}]); const r = await p; return [r.status, [...h]]`,
    `const p = fetch(${JSON.stringify(text)}); const s = ({ toString() { ${busy} return 's' } }).toLocaleString(); const r = await p; return [r.status, s]`,
    // Suspended inside a toJSON a crossing calls, and while a crossing's frame is parked with its search.
    `const w = tools.wait({}); return await tools.t.echo({ a: { toJSON() { ${busy} return 2 } }, w })`,
    `const w = tools.wait({}); return { a: { toJSON() { ${busy} return 2 } }, w }`,
    `const w = tools.wait({}); const n = search({ query: { toJSON() { ${busy} return 'echo' } } }).items.length; return [n, await w]`,
    `let w; const r = await tools.t.echo({ a: { toJSON() { w = tools.wait({}); return 1 } } }); return [r, await w]`,
    `return await tools.t.echo({ w: tools.wait({}), a: { toJSON() { for (let i = 0; i < 2000000; i++) {} return 2 } } })`,
    `function f() { return search({ query: { toJSON: () => 'echo' }, w: tools.wait({}) }).items.length } return [f(), 1]`,
    `function f() { return search({ w: tools.wait({}), query: { toJSON: () => 'echo' } }).items.length } return [f(), 1]`,
    // Suspended inside the toString of an entry's key or a pair's part.
    `return Object.fromEntries([[Object.create({ toString: () => 'k' + search({ query: tools.wait({}).then(() => 'echo') }).items.length }), 1]])`,
    `return String(new URLSearchParams([['a', { toString: () => 'b' + search({ query: tools.wait({}).then(() => 'echo') }).items.length }]]))`,
    `return [...new Headers([[Object.create({ toString: () => 'x-' + search({ query: tools.wait({}).then(() => 'echo') }).items.length }), 'v']])]`,
  ] as Array<string>,
})
