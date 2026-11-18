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

export default ({ after }: Helpers) => ({
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
    // Their fuel: the conversions run as calls, a built-in after them again.
    after(
      "const o = { valueOf() { return 1 }, toString() { return 'a' } }",
      "for (let j = 0; j < 300; j++) { o + 1; o < 2; o == 1; `${o}`; [o].join(); 'a'.padStart(o); String(o); Math.max(o, 0); const m = {}; m[o] = 1 }",
    ),
    after("const o = { valueOf() { return 3 } }", "for (let j = 0; j < 300; j++) { let s = 0; for (let i = 0; i < o; i++) s++; let x = o; x++ }"),
  ],
  suspensions: [
    `const o = { valueOf: () => search({ query: tools.wait({}).then(() => 'echo') }).items.length + 1 }; return [o + 1, 'a'.padStart(o)]`,
    `const r = []; for (const x of { [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n > 1, value: search({ query: tools.wait({}).then(() => 'echo') }).items.length + ++n }) } } }) r.push(x); return r`,
  ],
})
