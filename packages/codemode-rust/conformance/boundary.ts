#!/usr/bin/env bun

// Regenerates conformance/boundary.json from the reference's language layer (`Language.Runtime.make`): host values of
// every type crossing into programs and program values crossing out (`boundary`), and runtimes made with different
// host globals and module names (`configuration`): constructible globals, `import`/`require` by module name, and why
// an import can't be resolved. The Rust tests replay this recording.
// Usage: bun conformance/boundary.ts [reference] — the reference CodeMode package directory, from the argument,
// CODEMODE_REF, or by default ../codemode relative to this workspace.
//
// `boundary` programs run in `Runtime.make({ globals, translate: { functions: "drop", promises: "await" } })`, no
// `modules`, no `limits`, whose `globals()` gives:
// - `tools`: the namespace of conformance/reference.ts.
// - `keep(value)`: `Host.fn`, sync, `takesFunctions: true`; records `describe(value)` (see conformance/reference.ts)
//   in the program's `kept` and gives `value` back.
// - `make(name)`: `Host.fn`, sync, `takesFunctions: true`; gives `samples[name]` (a fresh copy crosses each call).
// - `kind(value)`: `Host.fn`, sync, `takesFunctions: true`; gives `value.constructor.name` as the host sees it.
// Each `run` takes one parameter (`length` 1) and is named by its global.
//
// `configuration` entries run in `Runtime.make({ globals, modules, translate? })` (the entry's `translate`, by default
// the reference's; no limits): `globals()`
// gives the globals of every set named in the entry's `globals`, and `modules` merges the module names of every set
// named in its `modules` (the same sets as `globals` when absent), a later set's name winning. Every host function
// below records `[name, args.map(describe)]` in the entry's `seen` when it says so, and its `run` takes as many
// parameters as listed:
// - `later`: `later(n)`, async; records; gives `n + 1`.
// - `files`: `read()`, sync; records; gives `"text"`.
// - `glob`: `Glob(pattern)`, sync, `constructible: true`; records; gives `{ match }`, where `match(name)` is a
//   function inside the result giving `name.endsWith(pattern)`.
// - `sum`: `Sum(...values)` (no parameters), sync, `constructible: true`; records; gives
//   `Effect.succeed({ total })`, the sum of `values`.
// - `plain`: `plain()`, sync; gives 1.
// - `bun`: `Bun`, a plain object `{ file }` where `file(path)` is sync and gives `{ name: path }`; module names
//   `{ bun: "Bun" }`.
// - `one`: `A`, `{ id }` where `id()` gives `"a"`; module names `{ shared: "A" }`.
// - `two`: `B`, `{ id }` where `id()` gives `"b"`; module names `{ shared: "B" }`.
// - `fs`: `fs`, `{ readFile, promises: { readFile } }`: `readFile(path)` sync, giving `"text of <path>"`;
//   `promises.readFile(path)` async, giving `path`.
//
// `results` entries run in `Runtime.make({ limits? })` with no globals, and the entry's `bindings` (recorded as
// `describe` writes them): what a program returns and logs when its strings
// have unpaired surrogates, which the result and logs keep, and how the output limit measures them.
//
// boundary.json: `{ boundary: { samples: { name: described }, programs: [{ code, outcome, kept }] },
// configuration: [{ globals, modules, translate?, code, outcome, seen }], results: [{ code, limits?, value | error,
// warnings, logs, truncated }] }`; `outcome` is `{ ok: true, value }` or `{ ok: false, kind, message }`, `modules`
// `null` when the
// entry names none of its own. A `results` entry's `value` is the result's value as `describe` writes it, `logs` its
// log lines as `describe` writes a string, and `error` (a failed run) and `warnings` its diagnostics: `{ kind, message,
// suggestions? }`, the message and suggestions as `describe` writes a string.

import { join } from "node:path"
import { writeRecording } from "./recording.ts"
import { describe, reference, toolsGlobal } from "./reference.ts"

type Json = null | boolean | number | string | Array<Json> | { [key: string]: Json }

const ref = await reference(process.argv[2] ?? process.env.CODEMODE_REF)
const Effect = ref.Effect
const Host = ref.Language.Host
const Runtime = ref.Language.Runtime
const tools = toolsGlobal(ref)

const outcome = (result: { ok: boolean; value?: unknown; error?: { kind: string; message: string } }) =>
  result.ok
    ? { ok: true, value: result.value }
    : { ok: false, kind: result.error!.kind, message: result.error!.message }

const samples: Record<string, unknown> = {
  date: new Date(0),
  invalidDate: new Date(Number.NaN),
  regexp: /a+\/b/gi,
  url: new URL("https://user@a.test:8080/p a?q=1&r=%20#h"),
  params: new URLSearchParams("a=1&b=2&a=3"),
  headers: new Headers([
    ["X-B", "2"],
    ["x-a", "1"],
    ["X-A", " 3 "],
  ]),
  bytes: new Uint8Array([1, 2, 3]),
  buffer: Buffer.from("hi"),
  arrayBuffer: new Uint8Array([4, 5]).buffer,
  nested: {
    when: new Date(1e12),
    links: [new URL("https://b.test/x")],
    table: new Map<unknown, unknown>([[new Date(5), new Headers({ k: "v" })]]),
    tags: new Set([new Uint8Array([9])]),
    failure: Object.assign(new RangeError("bad", { cause: new Date(7) }), { at: new URL("https://c.test/") }),
  },
  // Strings with unpaired surrogates, which have no UTF-8 form: as a value, a key, an error's message and field.
  lone: "a\ud800b",
  loneKeys: { "\udc00": "x\ud83d", pair: "\ud83d\ude00", list: ["\udbff"] },
  loneError: Object.assign(new Error("bad \ud800"), { "\udfff": "\ud800" }),
}
const boundaryPrograms = [
  `const o = { n: 1, list: [1], d: new Date(0), u: new URL("https://a.test/") }; keep(o); o.n = 2; o.list.push(2); return o.n`,
  `const h = make("headers"); h.set("x-a", "2"); const back = keep(h); back.set("x-a", "3"); return [h instanceof Headers, h.get("x-a"), back === h, back.get("x-a"), [...back], [...make("headers")]]`,
  `const b = make("bytes"); b[0] = 42; const mine = new Uint8Array([5]); const name = kind(mine); return [[...b], [...make("bytes")], [...make("arrayBuffer")], b instanceof Uint8Array, name, mine[0], kind(make("arrayBuffer"))]`,
  `const d = make("date"); return [d instanceof Date, d.getTime(), d.toISOString(), make("invalidDate").getTime(), keep(new Date(86400000)).getTime(), keep(new Date(NaN)).getTime()]`,
  `const r = make("regexp"); return [r instanceof RegExp, r.source, r.flags, r.test("aa/b"), keep(/x(y)\\//m).source]`,
  `const u = make("url"); return [u instanceof URL, u.href, u.pathname, u.port, u.searchParams.get("r"), keep(u).href, keep(u.searchParams).toString()]`,
  `const p = make("params"); return [p instanceof URLSearchParams, p.getAll("a"), p.toString(), keep(new URLSearchParams("x=1&x=2")).toString()]`,
  `const b = make("buffer"); return [Buffer.isBuffer(b), b.toString(), keep(Buffer.from("yo")).length, keep(new Uint8Array([7]))[0], kind(Buffer.from("z")), kind(new Uint8Array(1))]`,
  `return make("nested")`,
  `const n = make("nested"); return [n.when instanceof Date, n.links[0].host, [...n.table.keys()][0].getTime(), [...n.table.values()][0].get("k"), [...[...n.tags][0]], n.failure instanceof RangeError, n.failure.cause.getTime(), n.failure.at.href]`,
  `keep(make("nested")); return 1`,
  `keep(new Map([[new Date(1), new Set([new URL("https://m.test/")])]])); return 1`,
  `keep([new Headers({ "X-Y": "1" }), new URLSearchParams("z=9"), /q/]); return 1`,
  `function f() { return keep(arguments) }\nf(1, "two"); keep(new WeakMap()); keep(new TextDecoder()); return 1`,
  `try { keep((function* () {})()) } catch (e) { return e.message }`,
  `try { keep(new Map().entries()) } catch (e) { return e.message }`,
  `try { keep({ p: Promise.resolve(1) }) } catch (e) { return e.message }`,
  `return JSON.stringify([make("date"), make("url"), make("params"), make("headers"), make("bytes"), make("buffer"), make("regexp")])`,
]
// Strings with unpaired surrogates cross both ways unchanged: the host sees, and gives back, the program's code units.
// The programs return what they compare, as the recording's JSON can't hold such a string.
boundaryPrograms.push(
  `const s = "a\\ud800b"; const back = keep(s); return [back === s, back.length, back.charCodeAt(1), keep("\\udc00") === "\\udc00", keep("\\ud83d\\ude00") === "\\ud83d\\ude00", keep("\\ude00\\ud83d").length]`,
  `const k = "\\udc00"; const back = keep({ [k]: "x\\ud83d", n: ["\\udbff"], m: new Map([["\\ud800", new Set(["\\udfff"])]]) }); return [Object.keys(back)[0] === k, back[k] === "x\\ud83d", back.n[0] === "\\udbff", [...back.m.get("\\ud800")][0] === "\\udfff"]`,
  `const e = new Error("bad \\ud800"); e["\\udc00"] = "\\udfff"; const back = keep(e); return [back.message === "bad \\ud800", back["\\udc00"] === "\\udfff", back instanceof Error]`,
  `const l = make("lone"); const o = make("loneKeys"); const e = make("loneError"); return [l === "a\\ud800b", l.length, Object.keys(o)[0] === "\\udc00", o["\\udc00"] === "x\\ud83d", o.pair, o.list[0].charCodeAt(0), e.message === "bad \\ud800", e["\\udfff"] === "\\ud800"]`,
  `const l = make("lone"); return [l.isWellFormed(), l.toWellFormed(), encodeURIComponent(l.toWellFormed()), new TextEncoder().encode(l).length]`,
  // A namespace path's names reach the host's resolve and keys as the program wrote them; a label escapes them.
  `const p = tools["\\ud800"]; let m; try { await p() } catch (e) { m = e.message } let k; try { Object.keys(p) } catch (e) { k = e.message } let a; try { await tools["\\udc00"](Symbol.iterator) } catch (e) { a = e.message } return [m === "No function at tools.\\ud800.", k === "No namespace at tools.\\ud800.", a]`,
  // An error's own name and a RegExp's source cross unchanged.
  `const e = new Error("m"); e.name = "N\\ud800"; const back = keep(e); return [back.name === "N\\ud800", keep(new RegExp("a\\ud800")).source === new RegExp("a\\ud800").source]`,
)

// What a host function receives under the runtime's translation: a function is left out (an object's key is skipped,
// an array's item is null, an argument is undefined, a Map's or Set's entry is undefined), a fulfilled promise is its
// value, and the call waits for one that hasn't fulfilled, then crosses its arguments again.
boundaryPrograms.push(
  `keep({ f() {}, a: [1, () => 2, , 3], m: new Map([["k", () => 1], [() => 2, "v"]]), s: new Set([() => 1, 2]), n: { g: Math.max, b: keep.bind(null), k: keep } }); keep(() => 1); keep([keep]); return 1`,
  `const later = (v) => (async () => { await null; return v })()
   keep({ a: Promise.resolve(1), b: [Promise.resolve(2), later(3)], m: new Map([[Promise.resolve("k"), later("v")]]), s: new Set([later(4)]) }); keep(later(5), 6); return 1`,
  `const inner = (async () => { await null; return [() => 1, "in"] })(); keep({ outer: (async () => { await null; return { inner, f: () => 2 } })() }); return 1`,
  `try { keep({ p: (async () => { await null; throw new RangeError("late") })() }); return "no" } catch (e) { return [e.name, e.message] }`,
  `const o = {}; o.p = Promise.resolve(o); try { keep(o) } catch (e) { return e.message }`,
  `const a = {}; a.p = (async () => { await null; return a })(); try { keep(a) } catch (e) { return e.message }`,
  `const p = Promise.resolve({ v: 1 }); keep({ a: p, b: [p, p] }); return 1`,
  `const e = new TypeError("bad", { cause: (async () => { await null; return new Error("root") })() }); e.code = 7; e.fn = () => 1; e.sym = Symbol.iterator; e.later = Promise.resolve(8)
   keep(e); keep(Object.assign(new Error("m"), { name: "Custom", extra: 1 })); keep(new AggregateError([1], "agg")); const f = new Error("f"); f.name = "RangeError"; keep(f); return 1`,
  `let o = 1; for (let i = 0; i < 32; i++) o = { o }; keep(o); let p = 1; for (let i = 0; i < 31; i++) p = { p }; keep(Promise.resolve(p)); try { keep(Promise.resolve(o)) } catch (e) { return e.message }`,
  `try { keep({ t: tools }) } catch (e) { return e.message }`,
  `return [1, 2].map((x) => keep({ x: (async () => { await null; return x })() }))`,
  `const log = []; async function f() { log.push("f"); const v = keep((async () => { await null; log.push("v"); return 1 })()); log.push("kept"); return v } const p = f(); log.push("after"); await p; return log`,
  `function* g() { yield keep((async () => { await null; return 1 })()) } return [...g()]`,
)

const probe = (kept: Array<unknown>) => ({
  tools,
  keep: Host.fn(
    ([value]: ReadonlyArray<unknown>) => {
      kept.push(describe(value))
      return value
    },
    { takesFunctions: true },
  ),
  make: Host.fn(([name]: ReadonlyArray<string>) => samples[name], { takesFunctions: true }),
  kind: Host.fn(([value]: ReadonlyArray<{ constructor: { name: string } }>) => value.constructor.name, {
    takesFunctions: true,
  }),
})
const boundary = {
  samples: Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, describe(v)])),
  programs: [] as Array<unknown>,
}
for (const code of boundaryPrograms) {
  const kept: Array<unknown> = []
  const runtime = Runtime.make({ globals: () => probe(kept), translate: { functions: "drop", promises: "await" } })
  const result = await Effect.runPromise(runtime.execute(code))
  boundary.programs.push({ code, outcome: outcome(result), kept })
}

let seen: Array<unknown> = []
const saw = (name: string, args: ReadonlyArray<unknown>) => void seen.push([name, args.map(describe)])
const library: Record<string, { globals: Record<string, unknown>; modules?: Record<string, string> }> = {
  later: {
    globals: {
      later: Host.fn(
        ([n]: ReadonlyArray<number>) =>
          Effect.sync(() => {
            saw("later", [n])
            return n + 1
          }),
        { type: "async" },
      ),
    },
  },
  files: {
    globals: {
      read: Host.fn(() => {
        saw("read", [])
        return "text"
      }),
    },
  },
  glob: {
    globals: {
      Glob: Host.fn(
        ([pattern]: ReadonlyArray<string>) => {
          saw("Glob", [pattern])
          return { match: (name: string) => name.endsWith(pattern) }
        },
        { constructible: true },
      ),
    },
  },
  sum: {
    globals: {
      Sum: Host.fn(
        (...[values]: [ReadonlyArray<number>]) => {
          saw("Sum", values)
          return Effect.succeed({ total: values.reduce((total, value) => total + value, 0) })
        },
        { constructible: true },
      ),
    },
  },
  plain: { globals: { plain: Host.fn(() => 1) } },
  bun: {
    globals: { Bun: { file: Host.fn(([path]: ReadonlyArray<string>) => ({ name: path })) } },
    modules: { bun: "Bun" },
  },
  one: { globals: { A: { id: Host.fn(() => "a") } }, modules: { shared: "A" } },
  two: { globals: { B: { id: Host.fn(() => "b") } }, modules: { shared: "B" } },
  fs: {
    globals: {
      fs: {
        readFile: Host.fn(([path]: ReadonlyArray<string>) => `text of ${path}`),
        promises: { readFile: Host.fn(([path]: ReadonlyArray<string>) => Effect.succeed(path), { type: "async" }) },
      },
    },
  },
}
type ConfigurationCase = { globals: Array<string>; modules?: Array<string>; translate?: unknown; code: string }
const configurationCases: Array<ConfigurationCase> = [
  // A runtime's globals: every set it names, and nothing else.
  { globals: ["later", "files"], code: `return [typeof read, typeof later]` },
  { globals: ["later"], code: `return [typeof read, typeof later, await later(1)]` },
  { globals: [], code: `return [typeof read, typeof later]` },
  { globals: ["later", "files"], code: `return [read(), await later(2)]` },
  // A constructible global works with new and gives what the host function returns.
  { globals: ["glob"], code: `const g = new Glob(".ts"); return [g.match("a.ts"), g.match("a.js")]` },
  { globals: ["glob"], code: `return Glob(".ts").match("a.ts")` },
  { globals: ["glob"], code: `return new Glob(...[".ts"]).match("a.ts")` },
  { globals: ["glob"], code: `new (new Glob(".ts").match)("a")` },
  { globals: ["glob"], code: `return [typeof Glob, Glob.length, new Glob("x") instanceof Object]` },
  { globals: ["sum"], code: `return new Sum(1, 2).total + 1` },
  { globals: ["sum"], code: `return new Sum(...[1, 2]).total + 1` },
  { globals: ["sum"], code: `return new Sum((async () => { await null; return 1 })(), 2).total + 1` },
  {
    globals: ["sum"],
    translate: { promises: "await" },
    code: `return new Sum((async () => { await null; return 1 })(), 2).total + 1`,
  },
  { globals: ["plain"], code: `new plain()` },
  { globals: ["plain", "later"], code: `try { new later(1) } catch (e) { return e.message }` },
  // Module names load their globals; a name whose global the runtime lacks loads nothing; a later set's name wins.
  {
    globals: ["bun"],
    code: `import Loaded, { file } from "bun"
return [file("a").name, Loaded === Bun, typeof require("bun").file, typeof (await import("bun")).file]`,
  },
  { globals: ["bun"], code: `return [typeof require("node:bun").file, require("Bun") === Bun]` },
  { globals: [], modules: ["bun"], code: `import { file } from "bun"` },
  { globals: [], code: `import { file } from "bun"` },
  { globals: ["one", "two"], code: `return require("shared").id()` },
  { globals: ["two", "one"], code: `return require("shared").id()` },
  { globals: ["one"], code: `return require("shared").id()` },
  // An import that can't be resolved says why.
  ...[
    `import yaml from "yaml"`,
    `import ws from "ws"`,
    `import pkg from "@scope/pkg"`,
    `import x from "./local.js"`,
    `import x from "../up.js"`,
    `import x from "/abs.js"`,
    `import x from "file:///a.js"`,
    `import x from "node:sqlite"`,
    `import x from "bun"`,
    `import x from "bun:sqlite"`,
    `import x from "fs/extra"`,
    `import x from "zlib"`,
    `try { await import("child_process") } catch (e) { return e.message }`,
    `try { require("./x") } catch (e) { return e.message }`,
    `import { writeFile } from "fs"`,
  ].map((code) => ({ globals: ["fs"], code })),
  { globals: [], code: `require("fs")` },
]
const configuration: Array<unknown> = []
for (const item of configurationCases) {
  seen = []
  const runtime = Runtime.make({
    globals: () => Object.assign({}, ...item.globals.map((name) => library[name]!.globals)),
    modules: Object.assign({}, ...(item.modules ?? item.globals).map((name) => library[name]!.modules ?? {})),
    ...(item.translate === undefined ? {} : { translate: item.translate }),
  })
  const result = await Effect.runPromise(runtime.execute(item.code))
  configuration.push({ ...item, modules: item.modules ?? null, outcome: outcome(result), seen })
}

const resultCases: Array<{ code: string; limits?: { maxOutputBytes: number }; bindings?: Record<string, Json> }> = [
  {
    code: `console.log("a\\ud800"); console.log("pair \\ud83d\\ude00", "\\udc00"); console.log({ k: "\\udbff" })
return { s: "x\\udbff", ["\\udfff"]: ["\\ud800", { k: "\\ud83d" }], pair: "\\ud83d\\ude00", n: 1 }`,
  },
  { code: `return "\\ud800\\udc00\\udc00"` },
  { code: `return ["\\ud800".repeat(10), 1]`, limits: { maxOutputBytes: 20 } },
  { code: `console.log("\\ud800".repeat(4)); console.log("b"); return 1`, limits: { maxOutputBytes: 14 } },
  // Diagnostics keep them too: an error's message, an uncaught value, an unhandled rejection's warning.
  { code: `throw new TypeError("bad \\udc00 \\ud83d\\ude00")` },
  { code: `throw "y\\ud800"` },
  { code: `throw { a: "\\udbff" }` },
  { code: `Promise.reject(new Error("w\\ud800")); Promise.reject("\\udfff"); return 1` },
  { code: `null["\\ud800"]` },
  // Bindings carry them into the program, as values and as names of an object's keys.
  {
    code: `return [s === "a\\ud800", o["\\udc00"] === "\\udbff", s.length]`,
    bindings: { s: "a\ud800", o: { "\udc00": "\udbff" } },
  },
]
const results: Array<unknown> = []
for (const item of resultCases) {
  const runtime = Runtime.make(item.limits === undefined ? {} : { limits: item.limits })
  const result = await Effect.runPromise(runtime.execute(item.code, { bindings: item.bindings }))
  const diagnostic = (d: { kind: string; message: string; suggestions?: ReadonlyArray<string> }) => ({
    kind: d.kind,
    message: describe(d.message),
    ...(d.suggestions === undefined ? {} : { suggestions: d.suggestions.map(describe) }),
  })
  results.push({
    ...item,
    ...(item.bindings === undefined ? {} : { bindings: describe(item.bindings) }),
    ...(result.ok ? { value: describe(result.value) } : { error: diagnostic(result.error) }),
    warnings: (result.ok ? (result.warnings ?? []) : []).map(diagnostic),
    logs: (result.logs ?? []).map(describe),
    truncated: result.truncated === true,
  })
}

writeRecording(join(import.meta.dir, "boundary.json"), { boundary, configuration, results })
console.log(
  `${boundary.programs.length} boundary programs, ${configuration.length} configurations, ${results.length} results`,
)
