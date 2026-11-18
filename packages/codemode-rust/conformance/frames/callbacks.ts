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
  ] as Array<string>,
  programs: [
    `const t = Promise.prototype.then; const log = []; Promise.prototype.then = function (f, r) { log.push('then'); return t.call(this, f, r) }
     const n = await search({ query: 'echo' }).then((r) => r.items.length); Promise.prototype.then = t; return [n > 0, log]`,
    `const r = search({ query: 'echo' }); return [await r.catch(() => 0) === r, await r.finally(5) !== r, (await r.finally(() => 1)).items.length > 0]`,
  ] as Array<string>,
  suspensions: [
  ] as Array<string>,
})
