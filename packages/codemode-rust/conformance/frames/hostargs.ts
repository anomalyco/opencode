// Host-call arguments: what tools, `search` and extension functions receive. Every host call converts its arguments
// with the reference's `toHost` under Code Mode's translation: a function is left out (an object's key is skipped, an
// array's item is null, an argument is undefined, a Map's or Set's entry is undefined), a fulfilled promise is its
// value, and a call whose arguments hold a promise that hasn't fulfilled waits for each, then calls again
// (`$vmHostWait`). A tool's or search's arguments then become JSON as the tool runtime's `toJson` writes them; no
// `toJSON` of the program's runs. A function from a host result crosses back to an extension function as itself; an
// unknown tool's call rejects its promise. Cases for conformance/streaming.ts: `tools.t.echo` logs the JSON it got,
// `echo` (an extension function) hands back what it got, `fetch` is an async extension function.
type Helpers = {
  after: (setup: string, work: string) => string
  during: (setup: string, loop: string) => string
  text: unknown
}

// A promise that fulfills with `v` after `n` jobs.
const slow = "const slow = (v, n = 2) => (async () => { for (let i = 0; i < n; i++) await null; return v })()"
const late = (v: string) => `(async () => { await null; return ${v} })()`

export default ({ text }: Helpers) => ({
  searches: [],
  programs: [
    // Functions are left out at every position.
    `return await tools.t.echo({ f() {}, a: [1, () => 2, { g: () => 3 }], m: new Map([['k', () => 1]]), s: new Set([() => 1, 2]), n: { h: Math.max, t: tools.t.echo, b: (() => 1).bind(null) } })`,
    `return [await tools.t.echo(() => 1), await tools.t.echo(1, () => 2).catch((e) => [e.name, e.message])]`,
    // Promises: fulfilled at once, pending, at every position, at the top.
    `${slow}; return await tools.t.echo({ a: Promise.resolve(1), b: [slow(2), Promise.resolve(3)], c: new Set([slow(4)]), d: new Map([[slow('k'), slow('v')]]), e: { f: { g: slow(5, 3) } } })`,
    `return await tools.t.echo(${late("{ x: 1, f: () => 1 }")})`,
    `return await tools.t.echo([1, [Promise.reject(new RangeError('deep'))]]).catch((e) => [e.name, e.message])`,
    `const late = (async () => { await null; throw new TypeError('late') })(); return await tools.t.echo({ late, ok: Promise.resolve(1) }).catch((e) => [e.name, e.message])`,
    `${slow}; const no = (async () => { await null; throw new Error('first') })(); return await tools.t.echo([no, slow(1, 4)]).catch((e) => e.message)`,
    // A promise that fulfills with more promises, or with a function.
    `const inner = ${late("'in'")}; const outer = (async () => { await null; return { inner, deeper: (async () => { await null; await null; return [inner] })() } })(); return await tools.t.echo({ outer })`,
    `return await tools.t.echo({ p: Promise.resolve(() => 1), q: ${late("() => 2")}, r: [Promise.resolve(() => 3)], s: new Set([Promise.resolve(() => 4)]) })`,
    // Cycles through promises, and a promise shared without one.
    `const o = { n: 1 }; o.p = Promise.resolve(o); return await tools.t.echo(o).catch((e) => [e.name, e.message])`,
    `const o = { n: 1 }; o.p = (async () => { await null; return o })(); return await tools.t.echo(o).catch((e) => [e.name, e.message])`,
    `const p = Promise.resolve({ v: 1 }); return await tools.t.echo({ a: p, b: [p, p] })`,
    `let o = 1; for (let i = 0; i < 31; i++) o = { o }; const a = await tools.t.echo(Promise.resolve(o)).then(() => 'ok', (e) => e.message); const b = await tools.t.echo({ p: Promise.resolve(o) }).then(() => 'ok', (e) => e.message); return [a, b]`,
    // Built-in objects as the tool runtime writes them; toJSON is never called.
    `return await tools.t.echo({ d: new Date(0), bad: new Date(NaN), u: new URL('https://a.test/p?q=1#h'), q: new URLSearchParams('a=1&b=2'), h: new Headers({ B: '2', a: '1' }), m: new Map([[1, 2]]), s: new Set([1, 'x', { y: 1 }]), r: /x/g, w: new WeakMap(), n: [NaN, Infinity, -0], args: (function () { return arguments })(1, 2) })`,
    `Date.prototype.toJSON = () => 'nope'; URL.prototype.toJSON = () => 'no'; const d = new Date(0); d.toJSON = () => 'own'; return await tools.t.echo({ d, u: new URL('https://a.test/'), o: { toJSON: () => 'x', v: 1 } })`,
    `const e = new TypeError('bad', { cause: new Error('root') }); e.code = 7; e.fn = () => 1; e.later = ${late("8")}; return await tools.t.echo({ e, c: Object.assign(new Error('m'), { name: 'Custom', extra: 1 }), a: new AggregateError([1], 'agg'), u: new URIError('u') })`,
    `const e = new Error('m'); e.bad = Symbol.iterator; e.deep = [Symbol.asyncIterator]; e.ok = 1; return await tools.t.echo({ e })`,
    // A Uint8Array fails a tool's call once it starts; what toHost refuses fails it at once; an unknown tool fails first.
    `return await tools.t.echo({ b: Buffer.from('hi') }).catch((e) => [e.name, e.message])`,
    `return await tools.t.nope({ b: new Uint8Array(1) }).catch((e) => e.message)`,
    `return await tools.t.echo({ b: new Uint8Array(1), p: ${late("1")} }).catch((e) => [e.name, e.message])`,
    `return await tools.t.echo({ s: Symbol.iterator, b: new Uint8Array(1) }).catch((e) => [e.name, e.message])`,
    `return await Promise.all([tools.t.echo({ s: Symbol.iterator }), tools.t.echo({ t: tools }), tools.t.echo({ g: (function* () {})() }), tools.t.echo({ i: [1].values() })].map((p) => p.catch((e) => e.message)))`,
    `let o = 1; for (let i = 0; i < 32; i++) o = { o }; const a = await tools.t.echo(o).then(() => 'ok', (e) => e.message); const b = await tools.t.echo({ o }).then(() => 'ok', (e) => e.message); return [a, b]`,
    // When a waiting call starts, and the jobs its waits take.
    `const log = []; Promise.resolve().then(() => log.push('job1')); const a = tools.t.echo({ n: 'waits', p: (async () => { log.push('in'); await null; log.push('resolved'); return 1 })() }); const b = tools.t.echo({ n: 'now' }); Promise.resolve().then(() => log.push('job2')); await Promise.all([a, b]); return log`,
    `const log = []; const mk = (v, n) => (async () => { for (let i = 0; i < n; i++) await null; log.push(v); return v })()
     Promise.resolve().then(() => log.push('j1')).then(() => log.push('j2')).then(() => log.push('j3')).then(() => log.push('j4')).then(() => log.push('j5')).then(() => log.push('j6')).then(() => log.push('j7'))
     const r = tools.t.echo([mk('a', 3), mk('b', 1), mk('c', 2)]); r.then(() => log.push('settled')); await r; log.push('done'); return log`,
    `const log = []; const mk = (v, n) => (async () => { for (let i = 0; i < n; i++) await null; log.push(v); return v })()
     Promise.resolve().then(() => log.push('j1')).then(() => log.push('j2')).then(() => log.push('j3')).then(() => log.push('j4')).then(() => log.push('j5'))
     const v = echo([mk('a', 2), mk('b', 1)]); log.push('echoed'); return [v, log]`,
    // Search.
    `return search({ query: 'echo', fn: () => 1 }).items.length`,
    `return search(${late("'echo'")}).items.length`,
    `async function f() { return search({ query: ${late("'echo'")} }).items.length } const p = f(); return [typeof p.then, await p]`,
    `try { search({ query: (async () => { await null; throw new Error('late') })() }) } catch (e) { return [e.name, e.message] }`,
    `try { search({ query: new Uint8Array(1) }) } catch (e) { return [e.name, e.message] }`,
    `return [search({ query: new Date(0) }).items.length, search({ query: { toJSON: () => 'echo' } }).items.length]`,
    `return await tools.search({ query: ${late("'echo'")} }).then((r) => r.items.length)`,
    // Extension functions.
    `const r = echo({ f() {}, a: [() => 1, 2], m: new Map([['k', () => 1]]), s: new Set([() => 1]) }); return [Object.keys(r), r.a, [...r.m], [...r.s]]`,
    `${slow}; const s = slow('slow'); return echo({ p: Promise.resolve(1), q: s, l: [s] })`,
    `return [echo(Promise.resolve(5)), echo(${late("6")}), echo(() => 1) === undefined]`,
    `try { echo({ p: Promise.reject(new Error('x')) }) } catch (e) { return [e.name, e.message] }`,
    `return [1, 2].map((x) => echo({ v: ${late("x")} }))`,
    `function* g() { yield echo(${late("1")}); yield 2 } return [...g()]`,
    `const log = []; async function f() { log.push('f'); const v = echo(${late("1")}); log.push('echoed'); return v } const p = f(); log.push('after'); return [await p, log]`,
    `const r = await fetch(${late(JSON.stringify({ chunks: ["a", "b"] }))}); return await r.text()`,
    `return await fetch(Promise.reject(new Error('no'))).catch((e) => e.message)`,
    `let threw = false; let p; try { p = fetch({ s: Symbol.iterator }) } catch { threw = true } return [threw, await p.then(() => 'ok', (e) => [e.name, e.message])]`,
    // A function from a host result crosses back to an extension function as itself; a tool's arguments leave it out.
    `const r = await fetch(${JSON.stringify(text)}); const f = echo(r.text); return [typeof f, f === r.text, f.name, await f()]`,
    `const r = await fetch(${JSON.stringify(text)}); const o = echo({ t: r.text, list: [r.json], m: new Map([['k', r.bytes]]) }); return [typeof o.t, typeof o.list[0], typeof o.m.get('k'), await o.t()]`,
    `const r = await fetch(${JSON.stringify(text)}); return await tools.t.echo({ t: r.text, s: r.status, b: r.body })`,
    `return [echo(echo), echo({ e: echo, f: fetch })]`,
    // An unknown tool's call rejects its promise.
    `try { await tools.t.nope({}) } catch (e) { return e.message }`,
    `return await tools.t.nope({}).catch((e) => e.message)`,
    `const settled = await Promise.allSettled([tools.t.echo({}), tools.t.nope({})]); return settled.map((r) => r.status)`,
    `return await tools.t({}).catch((e) => e.message)`,
    `return await tools.t.ech({})`,
    `return [typeof tools.t.nope, Object.keys(tools.t)]`,
    `const p = tools.t.nope({}); return typeof p.then`,
    `return await tools.t.nope({ p: ${late("1")} }).catch((e) => e.message)`,
    `return await tools.t.nope({ s: Symbol.iterator }).catch((e) => [e.name, e.message])`,
  ],
  suspensions: [
    // Suspended while a call waits for a promise in its arguments.
    `const r = tools.t.echo({ w: tools.wait({}).then(() => ({ f: () => 1, v: 2 })) }); return await r`,
    `function f() { return echo({ w: tools.wait({}) }) } return [f(), 1]`,
    `return [1, 2].map((x) => echo({ w: tools.wait({}).then(() => x) }))`,
  ],
})
