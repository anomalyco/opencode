// Arrays and Uint8Array: cases for conformance/streaming.ts (see its `holding`, `after` and `during`).
type Helpers = {
  after: (setup: string, work: string) => string
  during: (setup: string, loop: string) => string
  text: unknown
}

const holdingIterable =
  "{ [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n > 1, value: S(++n) }), return: () => ({}) } } }"

export default (_: Helpers) => ({
  holds: [
    "[...new Uint8Array([1, 2]).map((x) => S(x) + x)]",
    "(() => { const r = []; new Uint8Array([1, 2]).forEach((x, i) => r.push(S(x) + i)); return r })()",
    "[...new Uint8Array([1, 2, 3]).filter((x) => S(x) >= 0 && x !== 2)]",
    "new Uint8Array([1, 2]).some((x) => S(x) < 0)",
    "new Uint8Array([1, 2]).every((x) => S(x) >= 0)",
    "new Uint8Array([1, 2]).find((x) => S(x) >= 0 && x === 2)",
    "new Uint8Array([1, 2]).findIndex((x) => S(x) >= 0 && x === 2)",
    "new Uint8Array([1, 2]).findLast((x) => S(x) >= 0 && x === 1)",
    "new Uint8Array([1, 2]).findLastIndex((x) => S(x) >= 0 && x === 1)",
    "new Uint8Array([1, 2]).reduce((a, x) => a + S(x) + x, 0)",
    "new Uint8Array([1, 2, 3]).reduceRight((a, x, i) => a + S(x) + i)",
    "[...Uint8Array.from([1, 2], (x, i) => S(x) + x + i)]",
    "[...Uint8Array.from(new Uint8Array([1, 2]), function (x) { return S(x) + x + this.k }, { k: 10 })]",
    `[...Uint8Array.from(${holdingIterable})]`,
    `[...Uint8Array.from(${holdingIterable}, (x) => S(x) + x)]`,
    `[...new Uint8Array(${holdingIterable})]`,
    `(() => { const u = new Uint8Array(4); u.set(${holdingIterable}, 1); return [...u] })()`,
  ] as Array<string>,
  programs: [
    "const u = new Uint8Array([1, 2]); return [...u.map((x) => (x === 1 ? 300 : '7'))]",
    "try { new Uint8Array([]).reduce((a, x) => a + x) } catch (e) { return [e.name, e.message] }",
    "try { Uint8Array.from([1, 2], (x) => { if (x === 2) throw new Error('m' + x); return x }) } catch (e) { return [e.name, e.message] }",
    "try { new Uint8Array(1).set({ [Symbol.iterator]: function* () { yield 1; yield 2 } }) } catch (e) { return [e.name, e.message] }",
    "const it = { [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n > 2, value: ++n }) } } }; const u = new Uint8Array(5); u.set(it, 2); return [[...u], [...new Uint8Array(it)], [...Uint8Array.from(it, (x) => x * 3)]]",
    "return [[...new Uint8Array(new Set([1, 2]))], [...Uint8Array.from('12')], [...Uint8Array.from(new Map([[3, 4]]).keys())], [...new Uint8Array([1, 2].values())], [...new Uint8Array((function* () { yield 5; yield 6 })())]]",
    "const u = new Uint8Array([5, 6, 7]); const seen = []; u.forEach((x, i, a) => { seen.push([x, i, a === u]); if (i === 0) u[2] = 9 }); return seen",
    "const u = new Uint8Array([1, 2, 3, 4]); return [u.some((x) => x > 3), u.every((x) => x > 0), u.findLast((x) => x < 3), u.findIndex((x) => x > 9), u.reduceRight((a, x) => a + x, '')]",
  ] as Array<string>,
  suspensions: [
    "return [...new Uint8Array([1, 2]).map((x) => hold({ query: wait({}).then(() => 'echo') }).items.length + x)]",
    "return [...Uint8Array.from([1, 2], (x) => hold({ query: wait({}).then(() => 'echo') }).items.length + x)]",
    "return new Uint8Array([1, 2]).reduce((a, x) => a + hold({ query: wait({}).then(() => 'echo') }).items.length + x, 0)",
  ] as Array<string>,
})
