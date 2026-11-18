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

export default (_: Helpers) => ({
  searches: [
    `(() => { const r = []; for (const x of ${counting}) r.push(x); return r })()`,
    `(() => { const r = []; for (const x of ${counting}) { r.push(x); break } return r })()`,
    `(() => { const [a] = ${counting}; return a })()`,
    `(() => { const [a, ...rest] = ${counting}; return [a, rest] })()`,
    `[...${counting}, 7]`,
    `Math.max(...${counting})`,
    `(() => { const it = { i: 0, next() { return { done: this.i > 1, value: S(++this.i) } }, [Symbol.iterator]() { return this } }; const r = []; for (const x of it) r.push(x); return r })()`,
  ],
  programs: [
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
  ],
  suspensions: [
    `const r = []; for (const x of { [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n > 1, value: search({ query: tools.wait({}).then(() => 'echo') }).items.length + ++n }) } } }) r.push(x); return r`,
  ],
})
