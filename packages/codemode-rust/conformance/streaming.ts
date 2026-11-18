#!/usr/bin/env bun

// Regenerates conformance/streaming.json: how the reference hands programs a streaming HTTP response, from a fake
// `fetch` extension global returning `Extension.StreamingResponse`, and what suspending a run that holds one does.
// The reference has no tests of its own for this; the Rust tests replay this recording.
// Usage: bun conformance/streaming.ts [reference] — the reference CodeMode package directory, from the argument,
// CODEMODE_REF, or by default ../codemode relative to this workspace.
//
// `fetch(spec)` answers with a response built from `spec`: `chunks` (text or bytes, one per read; omitted for no body),
// `fail` (the read at that index errors with `new Error("boom")`), `status`, `statusText`, `headers`, `redirected`,
// `delay` (each read waits that many milliseconds first). `echo(v)` hands back what it is given.

import { join, resolve } from "node:path"
import { writeRecording } from "./recording.ts"

const override = process.argv[2] ?? process.env.CODEMODE_REF
const pkg = override === undefined ? resolve(import.meta.dir, "../../codemode") : resolve(override)
const { Effect, Fiber, Schema } = await import(Bun.resolveSync("effect", join(pkg, "src")))
const { CodeMode, Extension, Tool, toolError } = await import(join(pkg, "src/index.ts"))

// The reference yields to the host (which is when a stream pulls) once its fuel runs out and `SLICE_MS` (1 ms) of
// `performance.now()` passed since its last yield; the Rust replay yields at every exhaustion. On a fast machine 10,000
// fuel can take less than a millisecond, so the busy loops below would record a later yield. A clock that moves a
// millisecond on every read makes every exhaustion a yield, so recordings don't depend on how fast this machine is.
let clock = performance.now()
performance.now = () => (clock += 1)

type Spec = {
  chunks?: Array<string | Array<number>>
  fail?: number
  status?: number
  statusText?: string
  headers?: Record<string, string>
  redirected?: boolean
  delay?: number
}

const respond = (spec: Spec, log: Array<unknown>) => {
  const encoder = { encode: (chunk: string | Array<number>) => (typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk)) }
  let index = 0
  const body =
    spec.chunks === undefined
      ? null
      : new ReadableStream<Uint8Array>({
          async pull(controller) {
            log.push(["pull", index])
            if (spec.delay !== undefined) await Bun.sleep(spec.delay)
            if (spec.fail === index) {
              controller.error(new Error("boom"))
              return
            }
            const chunk = spec.chunks![index++]
            if (chunk === undefined) controller.close()
            else controller.enqueue(encoder.encode(chunk))
          },
          cancel(reason) {
            log.push(["cancel", reason === undefined ? null : reason])
          },
        })
  const response = new Response(body, {
    status: spec.status ?? 200,
    ...(spec.statusText === undefined ? {} : { statusText: spec.statusText }),
    headers: spec.headers ?? {},
  })
  return new Extension.StreamingResponse(response, spec.redirected ?? false)
}

const web = (log: Array<unknown>, fetched?: () => void) =>
  Extension.make({
    name: "web",
    globals: {
      fetch: Extension.async(async (spec: Spec) => {
        const response = respond(spec, log)
        if (fetched !== undefined) setTimeout(fetched, 50)
        return response
      }),
      echo: (value: unknown) => value,
    },
  })

const text = { chunks: ["hel", "lo"], status: 201, statusText: "Created", headers: { "Content-Type": "text/plain", "X-A": "1" } }
const json = { chunks: ['{"a":', "[1,2]}"], headers: { "content-type": "application/json" } }

// Bodies `json()` reads, valid and not: the reference's messages are its host runtime's.
const jsonBodies = [
  "", " ", "{", "[1,", "abc", "nul", "tru", "1 2", '{"a":1}x', '{"a" 1}', "{a:1}", "[1,]", '{"a":1,}', '"x', '"\\q"',
  '"\\u12"', "01", "-", "1.", "1e", ".5", "+1", "[1 2]", '{"a":1 "b":2}', "'x'", "\u00a0 1", '"\t"',
  '{"__proto__":1,"a":2,"a":3}', "1e400", "-0", "[[[[]]]]", '{"":""}', "NaN", "Infinity", "undefined",
  "true false", ":", ",", "}", "]", "[", '"a\\"', '{"a":}', '{"a":1,"b"}', '{,}', "[,1]", "1e+", "0x10", "1_0",
  '"\\x41"', '"\\u00e9"', "\u2028 1", "[1]]", "{}}", "nulll", "truex", " \n\t\r 7 ", "\f1", '"\u0000"', '{"a":[}',
  "123abc", "[-]", "[1,,2]", '"\\"', "1.5e3", "-1.5E-3", "1e-400", "9007199254740993", '{"a":{"b":[1,{"c":null}]}}',
]

// Bodies whose JSON holds lone surrogates, escaped pairs and U+10FFFF, as escapes and as UTF-8.
const surrogateBodies = [
  ['"\\ud800"'], ['"\\udc00x"'], ['"a\\ud800\\ud800b"'], ['"\\ud83d\\ude00"'], ['"\\udbff\\udfff"'], ['"\\ud800\\udc00\\udc00"'],
  ['{"\\ud800":"\\udc00"}'], ['{"k\\udfff":"\\udbff\\udfffz"}'], [[0x22, 0xf4, 0x8f, 0xbf, 0xbf, 0x22]],
  [[0x22, 0xf4, 0x8f, 0xbf, 0xbf, 0xf4, 0x8f, 0xbf, 0xbf, 0x5c, 0x75, 0x64, 0x38, 0x30, 0x30, 0x22]], [[0x22, 0xed, 0xa0, 0x80, 0x22]],
]

const programs: Array<string> = [
  `const r = await fetch(${JSON.stringify(text)})
   return [r.url, r.status, r.statusText, r.ok, r.redirected, r.headers.get("content-type"), [...r.headers], r.bodyUsed,
     r.body === null, r.body.locked, typeof r.text, typeof r.body.getReader, Object.keys(r), Object.keys(r.body),
     r.text.name, r.body.getReader.name, r.headers instanceof Headers]`,
  `const r = await fetch(${JSON.stringify(text)}); const t = await r.text(); return [t, r.bodyUsed, r.body.locked]`,
  `const r = await fetch(${JSON.stringify(json)}); return [await r.json(), r.bodyUsed]`,
  `const r = await fetch(${JSON.stringify(text)}); const b = await r.bytes(); return [b instanceof Uint8Array, [...b]]`,
  `const r = await fetch(${JSON.stringify(text)}); const b = await r.arrayBuffer(); return [b instanceof Uint8Array, [...b]]`,
  `const r = await fetch({ chunks: ["{"], headers: { "content-type": "application/json" } })
   try { await r.json() } catch (e) { return [e.name, e.message, r.bodyUsed] }`,
  `const r = await fetch(${JSON.stringify(text)}); await r.text()
   try { await r.text() } catch (e) { return [e.name, e.message] }`,
  `const r = await fetch(${JSON.stringify(text)}); await r.text()
   try { r.body.getReader() } catch (e) { return [e.name, e.message] }`,
  `const r = await fetch(${JSON.stringify(text)}); const reader = r.body.getReader()
   const reads = []
   for (let i = 0; i < 4; i++) { const { done, value } = await reader.read(); reads.push([done, value === undefined ? null : [...value]]) }
   return [r.body.locked, r.bodyUsed, reads]`,
  `const r = await fetch(${JSON.stringify(text)}); r.body.getReader()
   try { r.body.getReader() } catch (e) { return [e.name, e.message, r.body.locked] }`,
  `const r = await fetch(${JSON.stringify(text)}); r.body.getReader()
   try { await r.text() } catch (e) { return [e.name, e.message, r.bodyUsed] }`,
  `const r = await fetch(${JSON.stringify(text)}); const reader = r.body.getReader(); reader.releaseLock()
   const after = r.body.locked
   try { await reader.read() } catch (e) { return [after, e.name, e.message] }`,
  `const r = await fetch(${JSON.stringify(text)}); const reader = r.body.getReader(); await reader.read(); reader.releaseLock()
   return [r.body.locked, r.bodyUsed, await r.body.getReader().read().then((x) => [x.done, [...x.value]])]`,
  `const r = await fetch(${JSON.stringify(text)})
   try { r.body.getReader({ mode: "byob" }) } catch (e) { return [e.name, e.message, r.body.locked] }`,
  `const r = await fetch(${JSON.stringify(text)}); const out = await r.body.cancel("enough")
   return [out === undefined, r.bodyUsed, r.body.locked, await r.text()]`,
  `const r = await fetch(${JSON.stringify(text)}); const reader = r.body.getReader(); await reader.read()
   const out = await reader.cancel("stop")
   return [out === undefined, r.body.locked, await reader.read()]`,
  `const r = await fetch(${JSON.stringify(text)}); r.body.getReader()
   try { await r.body.cancel() } catch (e) { return [e.name, e.message] }`,
  `const r = await fetch(${JSON.stringify(text)}); const parts = []
   for await (const chunk of r.body) parts.push([...chunk])
   return [parts, r.bodyUsed, r.body.locked]`,
  `const r = await fetch(${JSON.stringify(text)}); const parts = []
   for await (const chunk of r.body) { parts.push([...chunk]); break }
   return [parts, r.body.locked, await r.text().catch((e) => e.message)]`,
  `const r = await fetch({ chunks: ["a", "b"], fail: 1 }); const reader = r.body.getReader()
   const first = await reader.read()
   try { await reader.read() } catch (e) { return [[...first.value], e.name, e.message, r.body.locked] }`,
  `const r = await fetch({ chunks: ["a"], fail: 0 })
   try { await r.text() } catch (e) { return [e.name, e.message, r.bodyUsed] }`,
  `const r = await fetch({ chunks: ["a"], fail: 0 }); const parts = []
   try { for await (const c of r.body) parts.push([...c]) } catch (e) { return [parts, e.name, e.message] }`,
  `const r = await fetch({ status: 204 })
   return [r.body, r.bodyUsed, r.ok, await r.text(), r.bodyUsed, await r.text()]`,
  `const r = await fetch({ status: 404, statusText: "Not Found", chunks: ["missing"], redirected: true })
   return [r.ok, r.status, r.statusText, r.redirected, await r.text()]`,
  `const r = await fetch(${JSON.stringify(text)}); return r`,
  `const r = await fetch(${JSON.stringify(text)}); return JSON.stringify(r)`,
  `const r = await fetch(${JSON.stringify(text)}); const reader = r.body.getReader(); return [Object.keys(reader), typeof reader.read]`,
  `const r = await fetch(${JSON.stringify(text)}); try { r.bodyUsed = true } catch (e) { return [e.name, e.message] }`,
  `const r = await fetch(${JSON.stringify(text)}); try { r.body.locked = true } catch (e) { return [e.name, e.message] }`,
  `const r = await fetch(${JSON.stringify(text)})
   const before = ["bodyUsed" in r, r.hasOwnProperty("bodyUsed"), Object.keys(r).includes("bodyUsed"), "locked" in r.body]
   const deleted = [delete r.bodyUsed, "bodyUsed" in r, r.bodyUsed, delete r.body.locked, "locked" in r.body, r.body.locked]
   r.bodyUsed = 5; r.body.locked = 6
   return [before, deleted, r.bodyUsed, r.body.locked, Object.keys(r).includes("bodyUsed"), Object.keys(r.body)]`,
  `const r = await fetch(${JSON.stringify(text)}); r.status = 5; delete r.text; return [r.status, typeof r.text, Object.keys(r).length]`,
  `const r = await fetch(${JSON.stringify(text)}); const reader = r.body.getReader()
   return [r.text.length, r.json.length, r.body.cancel.length, r.body.getReader.length, r.body[Symbol.asyncIterator].length,
     r.body[Symbol.asyncIterator].name, reader.read.length, reader.cancel.length, reader.releaseLock.length, reader.read.name]`,
  `const r = await fetch(${JSON.stringify(text)}); console.log(r); console.log(r.body); console.log(r.body.getReader()); return [String(r), String(r.body), Object.entries(r.body)]`,
  `const r = await fetch(${JSON.stringify(text)}); return [JSON.stringify(r.body), JSON.stringify({ ...r.body }), Object.keys(r.body)]`,
  `const r = await fetch(${JSON.stringify(text)}); const reader = r.body.getReader(); await reader.read()
   try { await r.text() } catch (e) { return [e.name, e.message, r.bodyUsed, r.body.locked] }`,
  `const r = await fetch(${JSON.stringify(text)}); const reader = r.body.getReader(); await reader.read(); reader.releaseLock()
   try { await r.text() } catch (e) { return [e.name, e.message, r.bodyUsed, r.body.locked] }`,
  `const r = await fetch(${JSON.stringify(text)}); await r.body.cancel(); const after = [r.bodyUsed, r.body.locked]
   try { await r.bytes() } catch (e) { return [after, e.name, e.message] }`,
  `const r = await fetch({ status: 204 })
   const out = [[...(await r.bytes())], [...(await r.arrayBuffer())]]
   try { await r.json() } catch (e) { out.push([e.name, e.message]) }
   return out`,
  `const out = []
   for (const body of ${JSON.stringify(jsonBodies)}) {
     const r = await fetch({ chunks: [body] })
     try { const v = await r.json(); out.push(["ok", v, Object.is(v, -0)]) } catch (e) { out.push([e.name, e.message]) }
   }
   return out`,
  `const r = await fetch({ chunks: [[0xef, 0xbb, 0xbf, 0x7b, 0x7d]] }); return await r.json().catch((e) => e.message)`,
  `const out = []
   for (const chunks of ${JSON.stringify(surrogateBodies)}) {
     const v = await (await fetch({ chunks })).json()
     const s = typeof v === "string" ? v : Object.keys(v)[0] + "|" + Object.values(v)[0]
     const t = await (await fetch({ chunks })).text()
     out.push([s.length, [...s].map((c) => c.codePointAt(0)), JSON.stringify(v), s.isWellFormed(), t.length, [...t].map((c) => c.codePointAt(0))])
   }
   return out`,
  `const r = await fetch(${JSON.stringify(text)}); const p = r.text(); await null; await null; const now = [r.body.locked, r.bodyUsed]; await p; return now`,
  `const out = []
   for (const chunks of [[[0xef, 0xbb, 0xbf, 0x68, 0x69]], [[0xff, 0x61]], [[0xe2, 0x82], [0xac]], [[0xe2, 0x82]], [[0xef, 0xbb], [0xbf, 0x7b, 0x7d]],
       [[0xed, 0xa0, 0x80]], [[0xf0, 0x9f, 0x98, 0x80]], [[0xc0, 0x80]]]) {
     const t = await (await fetch({ chunks })).text()
     const j = await (await fetch({ chunks: [...chunks, [0x22]].map((c, i) => i === 0 ? [0x22, ...c] : c) })).json().catch((e) => e.message)
     out.push([[...t].map((c) => c.codePointAt(0)), typeof j === "string" ? [...j].map((c) => c.codePointAt(0)) : j])
   }
   return out`,
  `const r = await fetch(${JSON.stringify(text)}); const p = r.text(); const now = [r.body.locked, r.bodyUsed]; await p; return now`,
  `const r = await fetch(${JSON.stringify(text)}); const reader = r.body.getReader(); const p = reader.read(); const now = r.bodyUsed; await p; return now`,
  `const r = await fetch(${JSON.stringify(text)})
   const all = await Promise.allSettled([r.text(), r.text(), r.json()])
   return all.map((x) => x.status === "fulfilled" ? x.value : [x.reason.name, x.reason.message])`,
  `const r = await fetch(${JSON.stringify(text)}); const reader = r.body.getReader()
   const all = await Promise.all([reader.read(), reader.read(), reader.read(), reader.read()])
   return all.map((x) => [Object.keys(x), x.done, x.value === undefined ? null : [...x.value]])`,
  `const r = await fetch(${JSON.stringify(text)}); r.body.getReader()
   try { r.body[Symbol.asyncIterator]() } catch (e) { return [e.name, e.message] }`,
  `const r = await fetch(${JSON.stringify(text)}); const it = r.body[Symbol.asyncIterator]()
   const locked = r.body.locked
   try { r.body[Symbol.asyncIterator]() } catch (e) { return [locked, e.name, e.message] }`,
  `const r = await fetch(${JSON.stringify(text)}); const it = r.body[Symbol.asyncIterator]()
   const steps = []
   for (let i = 0; i < 4; i++) { const x = await it.next(); steps.push([Object.keys(x), x.done, x.value === undefined ? null : [...x.value], r.body.locked]) }
   const ret = await it.return()
   return [steps, Object.keys(ret), ret, r.bodyUsed]`,
  `const r = await fetch(${JSON.stringify(text)}); const it = r.body[Symbol.asyncIterator]()
   const ret = await it.return(); const again = await it.next()
   return [Object.keys(ret), ret.done, again.done, r.body.locked, r.bodyUsed, await r.text().catch((e) => e.message)]`,
  `const r = await fetch({ chunks: ["a"], fail: 0 }); const it = r.body[Symbol.asyncIterator]()
   const first = await it.next().catch((e) => [e.name, e.message])
   return [first, r.body.locked, await it.next().then((x) => x.done, (e) => e.message)]`,
  `const r = await fetch({ chunks: ["a", "b"], fail: 1 }); const reader = r.body.getReader(); await reader.read()
   const failed = await reader.read().catch((e) => e.message)
   const again = await reader.read().catch((e) => e.message)
   const cancelled = await reader.cancel("x").catch((e) => e.message)
   reader.releaseLock()
   return [failed, again, cancelled, r.body.locked, await r.body.cancel().catch((e) => e.message), await r.text().catch((e) => e.message)]`,
  `const r = await fetch(${JSON.stringify(text)}); const reader = r.body.getReader(); await reader.cancel()
   const cancelled = await reader.cancel("again"); reader.releaseLock()
   return [cancelled === undefined, await r.body.cancel("third"), await r.body.getReader().read()]`,
  `const r = await fetch(${JSON.stringify(text)}); try { await r.body.cancel(() => 1) } catch (e) { return [e.name, e.message, r.bodyUsed] }`,
  `const r = await fetch(${JSON.stringify(text)}); const reader = r.body.getReader()
   try { await reader.cancel(Symbol.iterator) } catch (e) { return [e.name, e.message] }`,
  `const r = await fetch(${JSON.stringify(text)})
   const out = []
   for (const o of [undefined, null, {}, { mode: undefined }, 5, "byob", { mode: "default" }]) {
     try { const reader = r.body.getReader(o); reader.releaseLock(); out.push("ok") } catch (e) { out.push(e.message) }
   }
   return out`,
  `const r = await fetch(${JSON.stringify(text)}); const reader = r.body.getReader(); reader.releaseLock(); return [await reader.read().catch((e) => e.name), reader.closed]`,
  `const r = await fetch({ chunks: ["a"], delay: 5 }); const reader = r.body.getReader(); const p = reader.read()
   await null; await null; reader.releaseLock()
   return [await p.then((x) => x.done, (e) => [e.name, e.message]), r.body.locked, r.bodyUsed]`,
  `const r = await fetch({ chunks: ["a"], delay: 5 }); const reader = r.body.getReader(); const p = reader.read()
   await null; await null; const c = await reader.cancel("c")
   return [c === undefined, await p.then((x) => [Object.keys(x), x.done, x.value === undefined], (e) => [e.name, e.message])]`,
  `const r = await fetch(${JSON.stringify(text)}); const out = []
   for (const v of [r, r.body, r.headers, { ...r, text: 1, json: 1, bytes: 1, arrayBuffer: 1, body: 1 }]) {
     try { out.push(echo(v)) } catch (e) { out.push([e.name, e.message]) }
   }
   return out`,
  `const r = await fetch(${JSON.stringify(text)}); return [typeof r.clone, typeof r.formData, typeof r.blob, r.type, typeof r.body.tee, typeof r.body.pipeTo, r.body.values]`,
  `const r = await fetch(${JSON.stringify(text)}); const copy = { ...r }; return [Object.keys(copy), copy.bodyUsed]`,
  `const r = await fetch(${JSON.stringify(text)}); const reader = r.body.getReader(); reader.releaseLock(); reader.releaseLock(); return [await reader.cancel().catch((e) => e.message), r.body.locked]`,
  `const r = await fetch(${JSON.stringify(text)}); const it = r.body[Symbol.asyncIterator](); const a = await it.next(); const b = await it.return(); return [[...a.value], a.done, b, r.body.locked]`,
]

// `t.echo` answers its input and logs that it started, so the log shows when each call's arguments had crossed.
const echo = (log: Array<unknown>) =>
  Tool.make({
    description: "Echoes its input",
    input: Schema.Unknown,
    output: Schema.Unknown,
    execute: (input: unknown) =>
      Effect.sync(() => {
        log.push(["echo", input])
        return input
      }),
  })

// `t.fail` always fails as it runs; `t.typed` takes `{ id: number }`.
const fail = (log: Array<unknown>) =>
  Tool.make({
    description: "Always fails",
    input: Schema.Unknown,
    output: Schema.Unknown,
    execute: (input: unknown) =>
      Effect.suspend(() => {
        log.push(["fail", input])
        return Effect.fail(toolError("boom"))
      }),
  })
const typed = (log: Array<unknown>) =>
  Tool.make({
    description: "Takes an id",
    input: Schema.Struct({ id: Schema.Number }),
    output: Schema.Number,
    execute: ({ id }: { id: number }) =>
      Effect.sync(() => {
        log.push(["typed", id])
        return id
      }),
  })
const tools = (log: Array<unknown>) => ({ t: { echo: echo(log), fail: fail(log), typed: typed(log) } })

const record = async (code: string) => {
  const log: Array<unknown> = []
  const runtime = CodeMode.make({ tools: tools(log), extensions: [web(log)] })
  const result = await Effect.runPromise(runtime.execute(code))
  return {
    code,
    outcome: result.ok
      ? { ok: true, value: result.value, ...(result.logs ? { logs: result.logs } : {}) }
      : { ok: false, kind: result.error.kind, message: result.error.message },
    log,
  }
}

// Busy loops: the reference starts queued calls whenever its interpreter runs out of fuel (10,000 units: one per loop
// back-edge, function call and job, fifty per call of a built-in or extension function), so a loop sees `locked` or
// `bodyUsed` change at a fixed iteration. The busy loops here and in conformance/frames/ keep one case per cost rule
// and code path (one built-in stands for its family): add a case for a new rule, not for another method of a family.
const busy = (setup: string, loop: string, op = "r.text()", flag = "r.body.locked") =>
  `const r = await fetch(${JSON.stringify(text)}); ${setup}; const p = ${op}; let flip = -1; const seen = () => flip < 0 && ${flag}
   ${loop}
   await p.catch(() => 0); return flip`
programs.push(
  busy("", "for (let i = 0; i < 30000; i++) { if (seen()) flip = i }"),
  busy("", "for (let i = 0; i < 30000; i++) if (flip < 0 && r.body.locked) flip = i"),
  busy("let i = 0", "while (i < 30000) { if (flip < 0 && r.body.locked) flip = i; i++ }"),
  busy("let i = 0", "do { if (flip < 0 && r.body.locked) flip = i; i++; if (i % 2) continue } while (i < 30000)"),
  busy("", "for (let i = 0; ; i++) { if (i % 3 === 0) continue; if (flip < 0 && r.body.locked) { flip = i; break } }"),
  busy("", "outer: for (let i = 0; i < 300; i++) for (let j = 0; j < 100; j++) { if (j === 50) continue outer; if (flip < 0 && r.body.locked) flip = i * 1000 + j }"),
  busy("const f = (x) => x", "for (let i = 0; i < 30000; i++) { f(i); if (flip < 0 && r.body.locked) flip = i }"),
  busy("function f(x) { return x }", "for (let i = 0; i < 30000; i++) { f?.(f(i)); if (flip < 0 && r.body.locked) flip = i }"),
  busy("const o = { m(x) { return x } }", "for (let i = 0; i < 30000; i++) { o.m(i); if (flip < 0 && r.body.locked) flip = i }"),
  busy("const f = (...x) => x; const g = f.bind(null, 1)", "for (let i = 0; i < 30000; i++) { f(...[i]); g(i); if (flip < 0 && r.body.locked) flip = i }"),
  busy("", "for (let i = 0; i < 30000; i++) { Math.abs(i); if (flip < 0 && r.body.locked) flip = i }"),
  busy("const a = []", "for (let i = 0; i < 30000; i++) { a.push(String(i)); JSON.stringify(i); if (flip < 0 && r.body.locked) flip = i }"),
  busy("", "for (let i = 0; i < 30000; i++) { new Map(); [i].length; if (flip < 0 && r.body.locked) flip = i }"),
  busy("", "for (let i = 0; i < 30000; i++) { echo(i); if (flip < 0 && r.body.locked) flip = i }"),
  busy("", "for (let i = 0; i < 30000; i++) { try { if (i % 7 === 0) throw new Error('x') } catch {} finally { if (flip < 0 && r.body.locked) flip = i } }"),
  busy("const tag = (s, v) => v", "for (let i = 0; i < 30000; i++) { tag`a${i}b`; if (flip < 0 && r.body.locked) flip = i }"),
  busy("const a = []; for (let i = 0; i < 30000; i++) a[i] = i", "for (const i of a) { if (flip < 0 && r.body.locked) flip = i }"),
  busy("const o = {}; for (let i = 0; i < 20000; i++) o['k' + i] = i", "for (const k in o) { if (flip < 0 && r.body.locked) flip = o[k] }"),
  busy("function* gen() { for (let i = 0; i < 30000; i++) yield i }", "for (const i of gen()) { if (flip < 0 && r.body.locked) flip = i }"),
  busy("function* gen() { for (let i = 0; i < 30000; i++) yield i }", "const it = gen(); for (let x = it.next(); !x.done; x = it.next()) { if (flip < 0 && r.body.locked) flip = x.value }"),
  busy("function* gen() { for (let i = 0; i < 30000; i++) yield i }", "const all = [...gen()]; for (const i of all) { if (flip < 0 && r.body.locked) flip = i }"),
  busy("function* gen() { for (let i = 0; i < 3; i++) yield i }", "for (let i = 0; i < 30000; i++) { const [a, b] = gen(); if (flip < 0 && r.body.locked) flip = i }"),
  busy("const a = []; for (let i = 0; i < 30000; i++) a[i] = i; function* gen() { yield* a }", "for (const i of gen()) { if (flip < 0 && r.body.locked) flip = i }"),
  busy("function* inner() { for (let i = 0; i < 30000; i++) yield i } function* gen() { yield* inner() }", "for (const i of gen()) { if (flip < 0 && r.body.locked) flip = i }"),
  busy("const it = { [Symbol.iterator]() { let i = 0; return { next: () => ({ done: i >= 30000, value: i++ }) } } }", "for (const i of it) { if (flip < 0 && r.body.locked) flip = i }"),
  busy("const m = new Map(); for (let i = 0; i < 30000; i++) m.set(i, i)", "for (const [k] of m) { if (flip < 0 && r.body.locked) flip = k }"),
  busy("const a = []; for (let i = 0; i < 30000; i++) a[i] = i", "for (const i of a.values()) { if (flip < 0 && r.body.locked) flip = i }"),
  busy("", "for (const c of 'x'.repeat(30000)) { if (flip < 0 && r.body.locked) flip = 1 }"),
  busy("const a = []; for (let i = 0; i < 30000; i++) a[i] = i", "for await (const i of a) { if (flip < 0 && r.body.locked) flip = i }"),
  busy("async function* gen() { for (let i = 0; i < 30000; i++) yield i }", "for await (const i of gen()) { if (flip < 0 && r.body.locked) flip = i }"),
  busy("const it = { [Symbol.iterator]() { let i = 0; return { next: () => ({ done: i >= 30000, value: i++ }) } } }; function* gen() { yield* it }", "for (const i of gen()) { if (flip < 0 && r.body.locked) flip = i }"),
  busy("function* gen() { yield 1; yield 2 }", "for (let i = 0; i < 30000; i++) { for (const x of gen()) break; if (flip < 0 && r.body.locked) flip = i }"),
  busy("const h = async (x) => x", "for (let i = 0; i < 30000; i++) { await h(i); if (flip < 0 && r.body.locked) flip = i }"),
  busy("for (let i = 0; i < 25000; i++) {}", "for (let i = 0; i < 30000; i++) { if (flip < 0 && r.body.locked) flip = i }"),
  busy("", "for (let i = 0; i < 30000; i++) { if (flip < 0 && r.bodyUsed) flip = i }", "r.body.cancel()", "r.bodyUsed"),
  busy("const reader = r.body.getReader()", "for (let i = 0; i < 30000; i++) { if (flip < 0 && r.bodyUsed) flip = i }", "reader.read()", "r.bodyUsed"),
  busy("", "for (let j = 0; j < 3; j++) { const q = r.body.cancel(); for (let i = 0; i < 9000; i++) { if (flip < 0 && r.bodyUsed) flip = j * 100000 + i } await q.catch(() => 0) }", "Promise.resolve()", "r.bodyUsed"),
)

// Busy loops over the built-ins the reference writes in its bytecode prelude, which spend that bytecode's fuel.
// `see(x)` counts its calls and records the count at the first that sees the body locked. `a` has 30,000 items with a
// hole at every third index, `d` its 20,000 items without holes. `during` reads the body while the built-in runs;
// `after` runs the built-in first, so the loop after it shows the fuel it left.
const base = `const r = await fetch(${JSON.stringify(text)}); let flip = -1; let k = 0
   const see = (x) => { k++; if (flip < 0 && r.body.locked) flip = k; return x }
   const a = []; for (let i = 0; i < 30000; i++) if (i % 3) a[i] = i; a.length = 30000; const d = a.filter(() => true)`
const during = (setup: string, loop: string) =>
  `${base}; ${setup}
   const p = r.text(); ${loop}
   await p.catch(() => 0); return flip`
const after = (setup: string, work: string) =>
  `${base}; ${setup}
   ${work}; const p = r.text(); for (let i = 0; i < 30000; i++) see(i)
   await p.catch(() => 0); return flip`
const range = (from: number, to: number) => `Array.from({ length: ${to - from} }, (_, i) => i + ${from})`
programs.push(
  during("", "a.forEach(see)"),
  during("", "a.flatMap((x) => x % 2 ? [see(x), , x] : see(x))"),
  during("const b = [1, , 3]", "for (let j = 0; j < 3000; j++) { b.map(see); b.some(see); b.reduce(see) }"),
  during("", "Array.prototype.forEach.call(a, see)"),
  after("const b = a.slice(0, 2000)", "b.toLocaleString(); [[], [1]].forEach((c) => c.reduce(see))"),
  after("const pairs = d.slice(0, 1000).map((x) => [x, x])", "new Map(pairs)"),
  during("const m = new Map(d.slice(0, 9000).map((x) => [x, x]))", "m.forEach(see)"),
  during("", "Object.groupBy(a, (x) => see(x) % 3)"),
  during("const m = new Map()", "for (let i = 0; i < 30000; i++) { m.getOrInsertComputed(i % 100, see); m.getOrInsert(i, 1) }"),
  // One method stands for the Set methods: they share the prelude loop and the set-like path.
  ...["union"].flatMap((name) => [
    after(`const s1 = new Set(${range(0, 1000)}); const s2 = new Set(${range(500, 1500)}); const s3 = new Set(${range(0, 300)})`,
      `s1.${name}(s2); s3.${name}(s1); s1.${name}(s3)`),
    during(`const like = { size: 3, has: (x) => see(x) % 7 === 0, keys: () => [1, 2, 3].values() }; const s1 = new Set(${range(0, 2)})`,
      `for (let j = 0; j < 3000; j++) { s1.${name}(like); see(j) }`),
  ]),
  during("const u = new Uint8Array(d.slice(0, 20000))", "u.forEach(see); u.map(see); u.filter(see)"),
  after("const b = d.slice(0, 3000); const u = new Uint8Array(3000)", "new Uint8Array(b); Uint8Array.from(b); u.set(b); u.set(new Uint8Array(b)); new Uint8Array(u)"),
  during("const b = d.slice(0, 3000).reverse()", "b.slice().sort((x, y) => see(x) - y); b.toSorted((x, y) => see(y) - x)"),
  after("const b = d.slice(0, 20000).reverse(); const c = d.slice(0, 4096)", "b.slice().sort(); c.slice().sort(); b.toSorted(); [3, 1, 2].sort((x, y) => x - y)"),
  during("const s = 'ab'.repeat(5000)", "s.replace(/b/g, see); s.replaceAll('a', see); s.replace('b', see); 'é'.repeat(2000).replaceAll('é', see); s.replace(/z/g, see)"),
  during("const j = JSON.stringify({ x: d.slice(0, 3000), y: { z: d.slice(0, 2000) } })", "JSON.parse(j, (key, v) => see(v))"),
  after("const pairs = d.slice(0, 2000).map((x) => [x, x])", "Object.fromEntries(pairs); Object.fromEntries(new Map(pairs)); Math.sumPrecise(d); AggregateError(d.slice(0, 1000)); new AggregateError(d)"),
  after("const pairs = d.slice(0, 1000).map((x) => ['k' + x, String(x)])", "new Headers(pairs); new URLSearchParams(pairs); new Headers({ a: 'b' }); new URLSearchParams(new URLSearchParams('a=b'))"),
  during("const h = new Headers(d.slice(0, 2000).map((x) => ['k' + x, String(x)])); const q = new URLSearchParams(d.slice(0, 2000).map((x) => ['k', String(x)]))", "h.forEach(see); q.forEach(see)"),
  during("const s = []; s[10000005] = 7; s[3] = 1; s[20] = 2", "s.forEach(see); s.reduceRight((t, x) => see(t), 0); [s].flatMap((x) => see(x))"),
  after("const s = []; s[10000005] = 7; s[3] = 1; s[20] = 2", "s.forEach((x) => x)"),
)

// Iterator helpers are prelude generators there, and the consumers prelude functions.
const gen = "function* g(n) { for (let i = 0; i < n; i++) yield i }"
// A built-in iterator a custom `Symbol.iterator` returns is stepped through its native `next`.
const wrapped =
  "const w = (x) => ({ [Symbol.iterator]: () => x[Symbol.iterator]() }); const A = w([1, 2, 3]), M = w(new Map([[1, 2]])), S = w('ab'), T = w(new Set([3, 4]))\n" +
  "   const H = w(new Headers([['a', 'b']])); const L = (function () { return w(arguments) })(5, 6)"
programs.push(
  during("", "d.values().map(see).toArray()"),
  during("", "d.values().flatMap((x) => [see(x), x]).toArray()"),
  during("", "d.values().reduce((s, x) => see(s)); d.values().some((x) => see(x) > 15000); d.values().every((x) => see(x) < 15000); d.values().find((x) => see(x) > 20000)"),
  during(gen, "for (let j = 0; j < 3000; j++) { const h = g(5).map(see); h.next(); h.return(); see(j) }"),
  during(gen, "for (let j = 0; j < 3000; j++) { Iterator.from(g(2)).toArray(); Iterator.from([1, 2]).toArray(); Iterator.from('ab').toArray(); see(j) }"),
  during("let n = 0; const custom = { next: () => ({ done: n++ % 4 === 3, value: n }) }", "for (let j = 0; j < 3000; j++) { Iterator.from(custom).toArray(); Iterator.prototype.toArray.call(custom); see(j) }"),
  during(wrapped, "for (let j = 0; j < 1000; j++) { for (const x of A) {} const [y, z] = M; [...S]; for (const x of T) break; const [h] = H; [...L]; see(j) }"),
  during(wrapped, "for (let j = 0; j < 1000; j++) { Array.from(A); new Map(M); Object.fromEntries(M); new Set(S); Promise.all(T); new Headers(H); see(j) }"),
  during(gen, "const b = d.slice(0, 7); for (let j = 0; j < 3000; j++) { Promise.all(b); Promise.race([1]); Promise.any(g(3)); Promise.allSettled([]); see(j) }"),
)

// for await over a sync iterable steps it through an adapter whose native next the loop calls; one the reference does
// not walk itself it opens in its internal bytecode and steps there. An async generator's own requests and its
// yield* spend fuel too. `after` shows the fuel the loop left, since every step starts a new job.
const syncs =
  gen +
  "; const it = { [Symbol.iterator]() { return this }, n: 0, next() { return { done: this.n++ % 3 === 2, value: 1 } } }\n" +
  "   const bound = { [Symbol.iterator]() { return this }, next: Object.fromEntries.bind(null, [['done', true]]) }\n" +
  "   const wrapped = { [Symbol.iterator]: () => [1, 2][Symbol.iterator]() }; const h = new Headers([['a', 'b']])\n" +
  "   async function* ag() { yield 1; yield* g(2) }"
programs.push(
  after(syncs, "for (let j = 0; j < 37; j++) { for await (const x of [1, 2]) {} for await (const x of 'ab') {} for await (const x of new Map([[1, 2]])) {} }"),
  after(syncs, "for (let j = 0; j < 37; j++) { for await (const x of ag()) {} }"),
  after(syncs + "; async function* a2() { yield* g(2) }", "for (let j = 0; j < 37; j++) { for await (const x of a2()) {} }"),
  after(syncs + "; const ai = { [Symbol.asyncIterator]() { let c = 0; return { next: async () => ({ done: c++ >= 2, value: 1 }) } } }; async function* a7() { yield* ai }", "for (let j = 0; j < 37; j++) { for await (const x of a7()) {} }"),
)

// A built-in that needs primitives lists them; once one is an object, the reference converts the list in its internal
// bytecode before the built-in runs again.
const objects =
  "const o = { valueOf: () => 1 }, s = { toString: () => 'b' }, n = {}, t = { toString: () => '[1]' }, dt = new Date(0)\n" +
  "   const v = { valueOf: () => see(1) }"
programs.push(
  during(objects, "for (let j = 0; j < 1000; j++) { 'abc'.slice(o, 2); 'abc'.padStart(o, s); see(j) }"),
  during(objects, "for (let j = 0; j < 1000; j++) { 'abc'.slice(v); Math.min(v, v); new Error(v); [1, 2].at(v); see(j) }"),
  during(objects, "for (let j = 0; j < 1000; j++) { [s, 'a', o].sort(); [n, 2, 1].toSorted(); [3, 1].sort(); see(j) }"),
  after(objects, "const big = Array.from({ length: 5000 }, (_, i) => i % 2 ? { toString: () => 'x' + i } : 'y' + i); big.sort()"),
)

// JSON.stringify with a replacer, a property list or a toJSON of the program's runs the reference's internal walk.
const doc = "const doc = { a: d.slice(0, 50), b: { c: 1, d: [1, { e: 2 }], f: undefined, g: () => 1 }, h: 'x', i: null, j: new Date(0), k: new Map() }"
programs.push(
  during(doc, "for (let j = 0; j < 300; j++) { JSON.stringify(doc, (key, v) => see(v)); see(j) }"),
  during(doc, "for (let j = 0; j < 3000; j++) { JSON.stringify(doc, ['a', 'b', 'c']); JSON.stringify(doc); see(j) }"),
  after(doc + "; const t = { x: [1, 2, { toJSON: () => 7 }], y: doc }", "JSON.stringify(t); JSON.stringify([doc, { toJSON() { return 1 } }])"),
  // Past depth 100 the internal walk throws through `$Throw`.
  after("let deep = 1; for (let i = 0; i < 101; i++) deep = { deep }", "for (let j = 0; j < 37; j++) try { JSON.stringify(deep, (k, v) => v) } catch {}"),
  // The native walk gives up at its 2,048th visit of an object it has seen already.
  after("const x = { a: 1 }; const many = Array(2049).fill(x); const fewer = Array(2048).fill(x)", "JSON.stringify(many); JSON.stringify(fewer)"),
  after("const x = [1, { b: 2 }]; const nest = Array(1100).fill({ p: x, q: x })", "JSON.stringify(nest); JSON.stringify(nest.slice(0, 600))"),
  during("const o = { valueOf: () => see(1), toString: () => 'k' }; const x = {}; let m = { valueOf() { return 2 } }",
    "for (let i = 0; i < 3000; i++) { o * 2; 2 < o; o >= 1; -o; o + 1; 'x' + o; o == 1; 1 != o; o | 0; `${o}`; x[o] = 1; m++; see(i) }"),
  `const ks = []; const s = JSON.stringify({ h: new Headers({ a: 'b' }), e: new TypeError('x'), u: new Uint8Array([1]) }, (k, v) => { ks.push(k); return v }, 1)
   return [s, ks, JSON.stringify({ h: new Headers({ a: 'b' }) }, ['h', 'z'])]`,
)

// Crossing to the host: a tool's or search's arguments, and the result, cross as JSON; a promise inside is awaited by
// the reference's internal walk, a toJSON of the program's is called there, and the call starts once they crossed.
const later = (v: string) => `new Promise((done) => setTimeout(() => done(${v}), 0))`
// `S(x)` runs a search whose input holds a promise, which parks the frames it is called from, and logs around it.
const searching = (expr: string) =>
  `const log = []; const S = (x) => { log.push('call ' + x); const n = search({ query: Promise.resolve('echo') }).items.length; log.push('answer ' + x); return n }
     Promise.resolve().then(() => log.push('job')); const r = ${expr}; return [r, log]`

programs.push(
  `return await tools.t.echo({ a: Promise.resolve(5), b: { toJSON: () => 7 }, c: [Promise.resolve(1), { d: Promise.resolve('x') }] })`,
  `return [await tools.t.echo(Promise.resolve({ x: 1 })), await tools.t.echo(), await tools.t.echo(undefined), await tools.t.echo(null)]`,
  `return await tools.t.echo({ s: new Set([Promise.resolve(2), 3]), q: new URLSearchParams('a=1'), h: new Headers({ k: 'v' }), d: new Date(0), m: new Map([[1, 2]]), e: new TypeError('x'), p: Promise.resolve(0), f: () => 1, u: undefined, n: NaN })`,
  `const o = { p: Promise.resolve(1) }; const shared = { v: 1 }; return await tools.t.echo({ o, x: [shared, shared, o] })`,
  `const big = Array(3000).fill({ k: 1 }); return (await tools.t.echo({ big })).big.length`,
  `const e = new Error('m'); e.extra = Promise.resolve(2); e.name = 'Custom'; return await tools.t.echo({ e })`,
  `return await tools.t.echo({ ['__proto__']: Promise.resolve(1), a: Promise.resolve(3) })`,
  `const p = tools.t.echo({ a: Promise.reject(new Error('no')) }); return await p.catch((e) => [e.name, e.message])`,
  `return await tools.t.echo({ p: Promise.resolve(1), t: { toJSON() { throw new TypeError('tj') } } }).catch((e) => [e.name, e.message])`,
  `return await tools.t.echo({ p: Promise.resolve(1), b: new Uint8Array(1) }).catch((e) => [e.name, e.message])`,
  `const a = { p: Promise.resolve(1) }; const b = { a }; return await tools.t.echo({ x: [b, b] })`,
  `let o = 1; for (let i = 0; i < 40; i++) o = { o }; return await tools.t.echo({ p: Promise.resolve(1), o }).then((r) => { let n = 0; while (r.o) { r = r.o; n++ } return n }, (e) => [e.name, e.message])`,
  `let o = 1; for (let i = 0; i < 120; i++) o = { o }; return await tools.t.echo({ p: Promise.resolve(1), o }).catch((e) => [e.name, e.message])`,
  `let o = Promise.resolve(1); for (let i = 0; i < 40; i++) o = { o }; return await tools.t.echo(o).catch((e) => [e.name, e.message])`,
  `return await tools.t.echo(1, Promise.resolve(2)).catch((e) => [e.name, e.message])`,
  `const log = []; const p = tools.t.echo({ a: { toJSON(k) { log.push('toJSON ' + k); return 1 } }, p: Promise.resolve(2) }); log.push('after'); return [log, await p]`,
  `const log = []; const p = tools.t.echo({ p: Promise.resolve(1), t: { toJSON() { log.push('late'); return 2 } } }); log.push('after'); await p; return log`,
  `const log = []; const a = tools.t.echo({ n: 'walked', p: Promise.resolve(1) }); const b = tools.t.echo({ n: 'plain' }); Promise.resolve().then(() => tools.t.echo({ n: 'job' })); log.push(typeof a.then)
   await Promise.all([a, b]); return log`,
  `const a = tools.t.echo({ n: 'later', p: ${later("1")} }); const b = tools.t.echo({ n: 'then' }); return [await a, await b]`,
  `const p = Promise.resolve(1); const calls = [1, 2, 3].map((n) => tools.t.echo({ n, p })); return await Promise.all(calls)`,
  `return await tools.search({ query: Promise.resolve('echo') }).then((r) => r.items.length)`,
  `return { a: Promise.resolve(5), b: [Promise.resolve(2), { c: Promise.resolve(3) }], d: { toJSON: () => 'D' } }`,
  `return Promise.resolve({ x: Promise.resolve(1) })`,
  `return { then(done) { done({ y: Promise.resolve(2) }) } }`,
  `return { a: Promise.reject(new TypeError('rejected')) }`,
  `return { a: Promise.resolve(1), t: { toJSON() { throw new RangeError('tj') } } }`,
  `let o = Promise.resolve(1); for (let i = 0; i < 40; i++) o = { o }; return o`,
  `let o = 1; for (let i = 0; i < 120; i++) o = { o }; return { p: Promise.resolve(1), o }`,
  `const log = []; Promise.resolve().then(() => log.push('job')); return { log, p: Promise.resolve(1).then(() => log.push('then')) }`,
  `return search({ query: Promise.resolve('echo') }).items.length`,
  `function f() { return search({ query: Promise.resolve('echo') }).items.length } return f()`,
  `const log = []; Promise.resolve().then(() => log.push('job')); const r = search({ query: Promise.resolve('echo') }); log.push('after'); return [log, r.items.length]`,
  `try { search({ query: Promise.reject(new Error('no')) }) } catch (e) { return [e.name, e.message] }`,
  `try { search({ query: { toJSON() { throw new Error('tj') } } }) } catch (e) { return [e.name, e.message] }`,
  `async function f() { return search({ query: Promise.resolve('echo') }).remaining } const p = f(); const t = typeof p.then; return [t, await p]`,
  `const g = (q) => search(q).items.length; return [g({ query: { toJSON: () => 'echo' } }), g({ query: Promise.resolve('echo') })]`,
  // A search that parks inside a built-in's callback parks the built-in's frame with it.
  ...[
    "[1, 2].map((x) => S(x))",
    "(() => { const r = []; [1, 2].forEach((x) => r.push(S(x))); return r })()",
    "[1, 2].filter((x) => S(x) >= 0)",
    "[1, 2].some((x) => S(x) < 0)",
    "[1, 2].every((x) => S(x) >= 0)",
    "[1, 2].find((x) => S(x) >= 0 && x === 2)",
    "[1, 2].findLastIndex((x) => S(x) >= 0 && x === 1)",
    "[1, 2].reduce((a, x) => a + S(x) + x, 0)",
    "[1, , 3].reduceRight((a, x) => a + S(x) + x)",
    "[1, 2].map((x) => [3].map((y) => S(y) + x))",
    "[2, 1].sort((a, b) => S(a) + a - b)",
    "Array.from([1, 2], (x) => S(x) + x)",
    "Array.from({ [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n > 1, value: S(++n) }), return: () => ({}) } } })",
    "[...new Map({ [Symbol.iterator]() { let n = 0; return { next: () => ({ done: n > 0, value: [++n, S(n)] }) } } })]",
    "await Promise.resolve(1).then((x) => S(x) + x)",
    "await Promise.reject(1).catch((x) => S(x) + x)",
    "await Promise.resolve(1).finally(() => S(1))",
    "await new Promise((done) => done(S(1)))",
    "await Promise.try((x) => S(x) + x, 1)",
    "await Promise.resolve({ then(done) { done(S(1)) } })",
    "(() => { const r = []; new Map([[1, 'a'], [2, 'b']]).forEach((v, k) => r.push(S(k) + v)); return r })()",
    "(() => { const r = []; new Set([1, 2]).forEach((v) => r.push(S(v) + v)); return r })()",
    "(() => { const r = []; new URLSearchParams('a=1&b=2').forEach((v) => r.push(S(v) + v)); return r })()",
    "[1, , 2].flatMap((x) => [S(x), x])",
    "Array.from({ length: 2 }, (_, i) => S(i) + i)",
    "[1, { toLocaleString: () => String(S(2)) }].toLocaleString()",
    "Object.groupBy([1, 2, 3], (x) => S(x) + (x % 2))",
    "[...Map.groupBy([1, 2], (x) => S(x) + x)]",
    "'abcab'.replace('b', (m) => S(1) + m)",
    "'abcab'.replaceAll('b', (m, i) => S(i) + i)",
    "'a1b2'.replace(/(\\d)/g, (m, d) => S(d) + d)",
    "(() => { const r = []; [1, 2].values().forEach((x) => r.push(S(x) + x)); return r })()",
    "[1, 2].values().some((x) => S(x) + x > 2)",
    "Iterator.from({ next() { return { done: false, value: 3 } } }).find((x) => S(x) > 0)",
    "[1, 2, 3].values().reduce((a, x) => a + S(x) + x)",
    "JSON.parse('[1,[2,{}],3]', (k, v) => (typeof v === 'number' ? S(v) + v : v))",
    "(function (x) { return S(x) + x + this.y }).call({ y: 10 }, 1)",
    "((x, y) => S(x) + x + y).apply(null, [1, 2])",
    // Inside a running sync generator the park takes the generator and the frames driving it.
    "(() => { function* g() { const a = S(1); yield a; yield a + 1 } const it = g(); return [it.next(), it.next(), it.next()] })()",
    "(() => { function* g() { yield S(1); yield S(2) + 1; return 9 } const out = []; for (const x of g()) out.push(x); return out })()",
    "(() => { function* g() { yield S(1); yield 5; yield S(2) } return [...g()] })()",
    "(() => { function* inner() { yield S(1); yield S(2) * 10 } const first = () => inner().next().value; function* outer() { yield* inner(); yield first() + 100; for (const x of inner()) yield x + 1000 } return [...outer()] })()",
    "await (async () => { function* g() { yield S(1); yield S(2) + 1 } const it = g(); const a = it.next().value; await null; return [a, it.next().value, [...g()]] })()",
    "(() => { function* g() { try { yield S(1) } finally { yield 'cleanup' } } const it = g(); return [it.next(), it.return(4), it.next(), it.next()] })()",
    "Array.from((function* () { yield S(1); yield S(2) })(), (x) => x + 1)",
  ].map(searching),
)

// Busy loops through the walk: its fuel decides when the reference starts the queued read.
programs.push(
  after("", "for (let j = 0; j < 37; j++) await tools.t.echo({ p: Promise.resolve(j), a: [1, { b: 2 }, [3]], s: 'x' })"),
  // Spreading a generator opens it with a call of its `Symbol.iterator`.
  after("function* g() { yield 1 }", "for (let j = 0; j < 37; j++) [...g()]"),
  after("", "for (let j = 0; j < 37; j++) await tools.t.echo([Promise.resolve(1), [Promise.resolve(2), [Promise.resolve(3)]]])"),
  after("const t = { toJSON: () => [1, 2] }", "for (let j = 0; j < 37; j++) await tools.t.echo({ t, p: Promise.resolve(1), e: new Error('x'), u: undefined })"),
  after("", "for (let j = 0; j < 37; j++) search({ query: Promise.resolve('echo'), limit: 1 })"),
  after("", "for (let j = 0; j < 37; j++) await tools.t.fail({}).catch(() => 0)"),
  after("", "for (let j = 0; j < 37; j++) await tools.t.typed({ id: 'x' }).catch(() => 0)"),
  after("", "for (let j = 0; j < 37; j++) await Promise.resolve(j).then((x) => x)"),
  after("", "for (let j = 0; j < 37; j++) await tools.t.nope({}).catch(() => 0)"),
  after("", "for (let j = 0; j < 37; j++) await Promise.resolve({ then(done) { done(j) } })"),
  after("", "for (let j = 0; j < 37; j++) await Promise.resolve(j).finally(() => 0)"),
  after("", "for (let j = 0; j < 37; j++) await Promise.try(() => j)"),
  after("let o = 1; for (let i = 0; i < 101; i++) o = { o }", "for (let j = 0; j < 37; j++) await tools.t.echo({ p: Promise.resolve(1), o }).catch(() => 0)"),
  during("const t = { toJSON: () => see(1) }", "for (let j = 0; j < 300; j++) { tools.t.echo({ t, a: [1, 2, { c: 3 }] }); see(j) }"),
  during("const t = { toJSON: () => see(1) }", "for (let j = 0; j < 300; j++) { search({ query: t }); see(j) }"),
  during("const x = { v: 1 }; const many = Array(2049).fill(x)", "for (let j = 0; j < 30; j++) { tools.t.echo({ many }); see(j) }"),
)

// Suspending while a run holds a response: `tools.wait` is idempotent and answers only once the run resumed.
const suspensions: Array<string> = [
  `const r = await fetch(${JSON.stringify(text)}); await tools.wait({}); return [r.status, r.bodyUsed]`,
  `const r = await fetch(${JSON.stringify(text)}); const t = await r.text(); await tools.wait({}); return t`,
  `const r = await fetch(${JSON.stringify(text)}); const s = r.status; const h = r.headers; await tools.wait({}); return [s, h.get("x-a")]`,
  `const r = await fetch(${JSON.stringify(text)}); const { status, statusText } = r; await tools.wait({}); return [status, statusText]`,
  `const r = await fetch(${JSON.stringify(text)}); const text = r.text; await tools.wait({}); return await text()`,
  `const r = await fetch(${JSON.stringify(text)}); const body = r.body; await tools.wait({}); return body.locked`,
  `async function get() { const r = await fetch(${JSON.stringify(text)}); return await r.text() }
   const t = await get(); await tools.wait({}); return t`,
  `async function get() { const r = await fetch(${JSON.stringify(text)}); return r.body }
   const body = await get(); await tools.wait({}); return body.locked`,
  `async function get() { const r = await fetch(${JSON.stringify(text)}); return r.text }
   const text = await get(); await tools.wait({}); return await text()`,
  // Suspended while a response has arrived but the run has not taken it yet: a busy loop holds the run.
  `const p = fetch(${JSON.stringify(text)}); for (let i = 0; i < 200000000; i++) {} const r = await p; return r.status`,
  // The same inside a built-in's callback, whose frame the snapshot saves.
  `const p = fetch(${JSON.stringify(text)}); const n = [1, 2].map((x) => { for (let i = 0; i < 200000000; i++) {} return x }); const r = await p; return [r.status, n]`,
  `const p = fetch(${JSON.stringify(text)}); const n = await Promise.resolve(2).then((x) => { for (let i = 0; i < 200000000; i++) {} return x }); const r = await p; return [r.status, n]`,
  // Suspended while a crossing awaits: a tool call's arguments, the result, and a search that parked its frames.
  `const r = tools.t.echo({ a: 1, w: tools.wait({}) }); return await r`,
  `return { a: 1, w: tools.wait({}), b: [Promise.resolve(2)] }`,
  `function f() { return search({ query: tools.wait({}).then(() => 'echo') }).items.length } return [f(), 1]`,
  `return [1, 2].map((x) => search({ query: tools.wait({}).then(() => 'echo') }).items.length + x)`,
  `return await Promise.resolve(1).then((x) => search({ query: tools.wait({}).then(() => 'echo') }).items.length + x)`,
  `function* g() { yield search({ query: tools.wait({}).then(() => 'echo') }).items.length; yield 7 }
   const caller = (it) => [it.next().value, it.next().value, it.next().done]; return [caller(g()), [...g()].length]`,
  `async function f() { function* g() { yield search({ query: tools.wait({}).then(() => 'echo') }).items.length }
   return [...g()] } return await f()`,
  `const t = { toJSON: () => 9 }; const r = tools.t.echo({ t, n: [1, { w: tools.wait({}) }], z: t }); return await r`,
]

// Each family of built-ins that run in native frames keeps its own cases in conformance/frames/: expressions to run with
// `S` (see `searching`), other programs, and suspensions.
for (const family of ["arrays", "iterators", "collections", "callbacks", "core"]) {
  const { default: cases } = await import(join(import.meta.dir, "frames", `${family}.ts`))
  const own = cases({ after, during, text })
  programs.push(...own.searches.map(searching), ...own.programs)
  suspensions.push(...own.suspensions)
}

const suspend = async (code: string) => {
  const log: Array<unknown> = []
  let resumed = false
  let started!: () => void
  const waiting = new Promise<void>((done) => (started = done))
  const wait = Tool.make({
    description: "Waits until the run resumed",
    input: Schema.Struct({}),
    output: Schema.Number,
    execute: Tool.idempotent(() =>
      resumed
        ? Effect.succeed(1)
        : Effect.callback<number>(() => {
            started()
          }),
    ),
  })
  // Without `tools.wait`, the suspend comes once the response has arrived.
  const runtime = CodeMode.make({
    tools: { wait, ...tools(log) },
    extensions: [web(log, code.includes("tools.wait") ? undefined : started)],
  })
  const program = runtime.program(code)
  const fiber = Effect.runFork(program.run())
  await waiting
  const suspended = await Effect.runPromise(Effect.result(program.suspend()))
  await Effect.runPromise(Fiber.join(fiber))
  if (suspended._tag === "Failure") return { code, suspend: { ok: false, message: suspended.failure.message }, log }
  const outcome = suspended.success
  if (outcome.ok !== "suspended") return { code, suspend: { ok: false, outcome }, log }
  resumed = true
  const after = await Effect.runPromise(Effect.result(runtime.resume(CodeMode.toBytes(outcome.state)).run()))
  return {
    code,
    suspend: { ok: true },
    resume:
      after._tag === "Failure"
        ? { ok: false, error: after.failure._tag, message: after.failure.message }
        : after.success.ok === true
          ? { ok: true, value: after.success.value }
          : { ok: false, kind: after.success.error.kind, message: after.success.error.message },
    log,
  }
}

const recordAll = async () => ({
  programs: await Promise.all(programs.map(record)),
  suspensions: await suspensions.reduce(
    async (done, code) => [...(await done), await suspend(code)],
    Promise.resolve([] as Array<unknown>),
  ),
})
// Everything is recorded twice: a recording that differs between the two depends on timing, which CI's freshness
// check and the Rust replay can't follow, so it fails here instead of being written.
const expected = await recordAll()
const again = await recordAll()
const unstable = (["programs", "suspensions"] as const).flatMap((kind) =>
  expected[kind].flatMap((entry, i) =>
    JSON.stringify(entry) === JSON.stringify(again[kind][i]) ? [] : [`${kind}[${i}]: ${(entry as { code: string }).code}`],
  ),
)
if (unstable.length > 0) {
  console.error(`recordings that differ between two runs (timing-dependent):\n${unstable.join("\n\n")}`)
  process.exit(1)
}
writeRecording(join(import.meta.dir, "streaming.json"), expected)
console.log(`${expected.programs.length} programs, ${expected.suspensions.length} suspensions`)
