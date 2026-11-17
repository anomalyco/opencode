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

import { writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const override = process.argv[2] ?? process.env.CODEMODE_REF
const pkg = override === undefined ? resolve(import.meta.dir, "../../codemode") : resolve(override)
const { Effect, Fiber, Schema } = await import(Bun.resolveSync("effect", join(pkg, "src")))
const { CodeMode, Extension, Tool } = await import(join(pkg, "src/index.ts"))

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

const web = (log: Array<unknown>) =>
  Extension.make({
    name: "web",
    globals: { fetch: Extension.async(async (spec: Spec) => respond(spec, log)), echo: (value: unknown) => value },
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

const record = async (code: string) => {
  const log: Array<unknown> = []
  const result = await Effect.runPromise(CodeMode.make({ extensions: [web(log)] }).execute(code))
  return {
    code,
    outcome: result.ok
      ? { ok: true, value: result.value, ...(result.logs ? { logs: result.logs } : {}) }
      : { ok: false, kind: result.error.kind, message: result.error.message },
    log,
  }
}

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
]

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
  const runtime = CodeMode.make({ tools: { wait }, extensions: [web(log)] })
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

const expected = {
  programs: await Promise.all(programs.map(record)),
  suspensions: await Promise.all(suspensions.map(suspend)),
}
writeFileSync(join(import.meta.dir, "streaming.json"), JSON.stringify(expected, null, 2) + "\n")
console.log(`${expected.programs.length} programs, ${expected.suspensions.length} suspensions`)
