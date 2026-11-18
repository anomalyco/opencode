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
    during("const it = () => ({ [Symbol.iterator]() { let n = 0; return { next: () => (n < 3 ? { done: false, value: ['k' + n, see(n++)] } : { done: true }) } } })",
      "for (let j = 0; j < 300; j++) { Object.fromEntries(it()); new URLSearchParams(it()); new Headers(it()); Math.sumPrecise(new Set([1, 2])); new AggregateError(it()); see(j) }"),
    after("", "for (let j = 0; j < 37; j++) Object.fromEntries([['a', j]])"),
    after("", "for (let j = 0; j < 37; j++) new AggregateError([j])"),
    after("", "for (let j = 0; j < 37; j++) Math.sumPrecise([j, 1])"),
    after("", "for (let j = 0; j < 37; j++) ({}).toLocaleString()"),
    after("", "for (let j = 0; j < 37; j++) { new URLSearchParams([['a', 'b']]); new Headers([['a', 'b']]) }"),
  ] as Array<string>,
  suspensions: [
    `const p = fetch(${JSON.stringify(text)}); const o = Object.fromEntries(${iterable(`(n++ ? (() => { ${busy} return ['b', n] })() : ['a', n])`)}); const r = await p; return [r.status, o]`,
    `const p = fetch(${JSON.stringify(text)}); const h = new Headers([${iterable(`(n++ ? (() => { ${busy} return 'v' })() : 'k')`)}]); const r = await p; return [r.status, [...h]]`,
    `const p = fetch(${JSON.stringify(text)}); const s = ({ toString() { ${busy} return 's' } }).toLocaleString(); const r = await p; return [r.status, s]`,
  ] as Array<string>,
})
