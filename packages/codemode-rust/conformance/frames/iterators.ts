// Iterators, iterator helpers and the built-ins that drive generators: cases for conformance/streaming.ts (see its `holding`, `after` and `during`).
type Helpers = {
  after: (setup: string, work: string) => string
  during: (setup: string, loop: string) => string
  text: unknown
}

const gen = "function* g(n) { for (let i = 0; i < n; i++) yield i }"
// A source that logs each call of its `next` and `return`, failing where asked.
const logged = `const log = []
   const src = (n, fail = {}) => ({ i: 0, next() { log.push('next ' + this.i); if (fail.next === this.i) throw new Error('next ' + this.i); return this.i < n ? { done: false, value: this.i++ } : { done: true } }, return() { log.push('return'); if (fail.ret) throw new Error('return'); return fail.bad ? 5 : {} } })
   const H = Iterator.prototype
   const attempt = (f) => { try { return f() } catch (e) { return e.name + ': ' + e.message } }`
// Spins for 250 ms of wall-clock time: see the busy loops in streaming.ts.
const busy = "for (let end = Date.now() + 250; Date.now() < end; ) {}"

export default ({ after, during, text }: Helpers) => ({
  // A `hold` call parked inside a helper's callback or the source's `next` it calls fails in the reference ("Iterator
  // helper is already running."), so only `Iterator.from` calling an iterable's own method calls `hold` here.
  holds: [
    "Iterator.from({ [Symbol.iterator]() { const n = S(1); return [n, 2].values() } }).toArray()",
  ] as Array<string>,
  programs: [
    // Closing the source when a callback, `flatMap`'s inner record or its opening fails, and not when the source fails.
    `${logged}
     return [
       attempt(() => H.map.call(src(3), (x) => { if (x === 1) throw new Error('map'); return x }).toArray()),
       attempt(() => H.filter.call(src(3), (x) => { throw new TypeError('filter') }).next()),
       attempt(() => H.map.call(src(3, { next: 1 }), (x) => x).toArray()),
       attempt(() => H.map.call(src(3, { ret: true }), () => { throw new Error('kept') }).next()),
       attempt(() => H.flatMap.call(src(3), (x) => x).next()),
       attempt(() => H.flatMap.call(src(3), () => ({ [Symbol.iterator]: 5 })).next()),
       attempt(() => H.flatMap.call(src(3), () => ({ [Symbol.iterator]() { throw new Error('open') } })).next()),
       attempt(() => H.flatMap.call(src(3), () => ({ next: () => 5 })).next()),
       attempt(() => H.flatMap.call(src(3), () => ({ next() { throw new Error('inner') } })).next()),
       log,
     ]`,
    // return() before the first value, at a yield, with flatMap's inner record open, failing, and twice.
    `${logged}
     const inner = () => ({ next: () => ({ done: false, value: 'i' }), return() { log.push('inner return'); throw new Error('inner') } })
     const a = H.map.call(src(3), (x) => x); log.push(JSON.stringify(a.return()), JSON.stringify(a.next()))
     const b = H.map.call(src(3), (x) => x); b.next(); log.push(JSON.stringify(b.return()), JSON.stringify(b.return()))
     const c = H.flatMap.call(src(3), inner); c.next(); log.push(attempt(() => c.return()), JSON.stringify(c.next()))
     const d = H.flatMap.call(src(3, { ret: true }), inner); d.next(); log.push(attempt(() => d.return()))
     const e = H.drop.call(src(3, { bad: true }), 1); e.next(); log.push(attempt(() => e.return()))
     const f = H.take.call(src(3, { bad: true }), 1); log.push(attempt(() => f.return()))
     const t = H.take.call(src(3, { bad: true }), 1); t.next(); log.push(attempt(() => t.next()), attempt(() => t.next()))
     const z = H.take.call(src(3), 0); log.push(JSON.stringify(z.next()))
     const odd = { next: () => ({ done: false, value: 1 }), return: 5 }
     const q = H.map.call(odd, (x) => x); q.next(); log.push(attempt(() => q.return()), attempt(() => H.map.call(odd, (x) => x).return()))
     log.push(attempt(() => H.map.call(odd, () => { throw new Error('cb') }).next()))
     return log`,
    // A helper stepped again while its step runs, from its callback and from its source.
    `${logged}
     let h; h = [1, 2].values().map((x) => attempt(() => h.next())); const r1 = h.next()
     let k; k = Iterator.from({ next: () => ({ done: false, value: attempt(() => k.next()) }) }).map((x) => x); const r2 = k.next()
     let m; m = [1, 2].values().map((x) => JSON.stringify(m.return())); const r3 = attempt(() => m.next())
     const r4 = [r1, r2, r3, h.next(), k.next().value, attempt(() => h.return())]
     return r4`,
    // Generators as sources and inner records: their completion, their `finally`, and a generator's own `next`.
    `${gen}
     const log = []
     function* f() { try { yield 1; yield 2 } finally { log.push('finally') } }
     const a = f().map((x) => x * 2); log.push(a.next().value); a.return()
     const b = f().take(1); log.push(b.next().value, b.next().done)
     const c = [1, 2].values().flatMap(f); log.push(c.next().value); c.return()
     const d = f(); d.next = () => ({ done: false, value: 'own' }); log.push(d.map((x) => x).next().value)
     function* thrower() { yield 1; throw new Error('gen') }
     try { thrower().map((x) => x).toArray() } catch (e) { log.push(e.message) }
     function* bad() { try { yield 1 } finally { throw new Error('finally') } }
     try { bad().map((x) => { throw new Error('cb') }).next() } catch (e) { log.push(e.message) }
     const e = bad().drop(0); e.next(); try { e.return() } catch (err) { log.push(err.message) }
     log.push(g(6).drop(1).filter((x) => x % 2).flatMap((x) => g(x)).take(5).toArray().join())
     return log`,
    // Iterator.from over a program's iterable, a string, an iterator and a value that is neither.
    `const log = []
     const it = { [Symbol.iterator]() { log.push('open'); return { next: () => ({ done: true }) } } }
     const a = Iterator.from(it); log.push(typeof a.next, JSON.stringify(a.next()))
     log.push(Iterator.from('ab').toArray().join(), Iterator.from({ next: () => ({ done: true }) }).toArray().length)
     for (const v of [5, { [Symbol.iterator]: 5 }, { [Symbol.iterator]: () => 5 }, { [Symbol.iterator]() { throw new RangeError('open') } }])
       try { Iterator.from(v) } catch (e) { log.push(e.name + ': ' + e.message) }
     return log`,
  ] as Array<string>,
  // Suspended while a busy loop runs inside a helper's callback, its source's `next`, an inner record or a close.
  suspensions: [
    `const p = fetch(${JSON.stringify(text)}); const n = [1, 2].values().map((x) => { ${busy} return x }).toArray(); const r = await p; return [r.status, n]`,
    `const p = fetch(${JSON.stringify(text)}); const n = [1, 2, 3].values().filter((x) => { if (x === 2) { ${busy} } return x !== 2 }).toArray(); const r = await p; return [r.status, n]`,
    `const p = fetch(${JSON.stringify(text)}); let k = 0; const src = { next() { if (k === 1) { ${busy} } return { done: k > 2, value: k++ } } }
     const n = Iterator.prototype.map.call(src, (x) => x * 2).toArray(); const r = await p; return [r.status, n]`,
    `const p = fetch(${JSON.stringify(text)}); const inner = () => { let d = false; return { next() { if (!d) { ${busy} } const r = { done: d, value: 7 }; d = true; return r } } }
     const n = [1, 2].values().flatMap(inner).toArray(); const r = await p; return [r.status, n]`,
    `const p = fetch(${JSON.stringify(text)}); const log = []; const src = { next: () => ({ done: false, value: 1 }), return() { ${busy} log.push('closed'); return {} } }
     const h = Iterator.prototype.map.call(src, (x) => x); h.next(); const done = h.return(); const r = await p; return [r.status, done, log]`,
    `const p = fetch(${JSON.stringify(text)}); const it = { [Symbol.iterator]() { ${busy} return [1, 2].values() } }
     const n = Iterator.from(it).toArray(); const r = await p; return [r.status, n]`,
  ] as Array<string>,
})
