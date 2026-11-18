#!/usr/bin/env bun

// Regenerates conformance/tools.json: what the reference does with tool calls whose input is invalid, next to valid,
// denied and failing ones: when each settles against other jobs, its message, the `tool.before` and `tool.after` hooks
// it runs, `toolCalls`, and what counts against `maxToolCalls`. The Rust tests replay this recording.
// Usage: bun conformance/tools.ts [reference] — the reference CodeMode package directory, from the argument,
// CODEMODE_REF, or by default ../codemode relative to this workspace.

import { join, resolve } from "node:path"
import { writeRecording } from "./recording.ts"

const override = process.argv[2] ?? process.env.CODEMODE_REF
const pkg = override === undefined ? resolve(import.meta.dir, "../../codemode") : resolve(override)
const { Effect, Schema } = await import(Bun.resolveSync("effect", join(pkg, "src")))
const { CodeMode, Tool, toolError } = await import(join(pkg, "src/index.ts"))

// `t.typed` takes `{ id: number }`, `t.echo` anything, `t.fail` fails as it runs; each logs that it ran. `tool.before`
// logs and denies an input with `deny: true`; `tool.after` logs how the call ended.
const runtime = (log: Array<unknown>, maxToolCalls?: number) =>
  CodeMode.make({
    tools: {
      t: {
        typed: Tool.make({
          description: "Takes an id",
          input: Schema.Struct({ id: Schema.Number }),
          output: Schema.Number,
          execute: ({ id }: { id: number }) => Effect.sync(() => (log.push(["run", "t.typed", id]), id)),
        }),
        echo: Tool.make({
          description: "Echoes its input",
          input: Schema.Unknown,
          output: Schema.Unknown,
          execute: (input: unknown) => Effect.sync(() => (log.push(["run", "t.echo", input]), input)),
        }),
        fail: Tool.make({
          description: "Always fails",
          input: Schema.Struct({}),
          output: Schema.Number,
          execute: () => Effect.suspend(() => (log.push(["run", "t.fail"]), Effect.fail(toolError("boom")))),
        }),
      },
    },
    hooks: {
      "tool.before": (call: { name: string; input: unknown }) =>
        Effect.suspend(() => {
          log.push(["before", call.name, call.input])
          const deny = typeof call.input === "object" && call.input !== null && "deny" in call.input
          return deny ? Effect.fail(toolError("denied")) : Effect.void
        }),
      "tool.after": (call: { name: string }, result: { status: string }) =>
        Effect.sync(() => log.push(["after", call.name, result.status])),
    },
    ...(maxToolCalls === undefined ? {} : { limits: { maxToolCalls } }),
  })

const cases: Array<{ code: string; maxToolCalls?: number }> = [
  {
    code: `const log = []; const a = tools.t.typed({ id: 'x' }).then(() => log.push('a ok'), (e) => log.push('a rejected'))
     const b = tools.t.typed({ id: 1 }).then(() => log.push('b ok'))
     Promise.resolve().then(() => log.push('job 1')).then(() => log.push('job 2')).then(() => log.push('job 3')).then(() => log.push('job 4'))
     await Promise.all([a, b]); return log`,
  },
  {
    code: `const log = []; const a = tools.t.echo(1, 2).catch(() => log.push('arity')); const b = tools.t.nope({}).catch(() => log.push('unknown'))
     const c = tools.t.fail({}).catch(() => log.push('failed')); Promise.resolve().then(() => log.push('job')).then(() => log.push('job 2'))
     await Promise.all([a, b, c]); return log`,
  },
  {
    code: `const m = (p) => p.then((v) => ['ok', v], (e) => [e.name, e.message])
     return [await m(tools.t.typed({ id: 'x' })), await m(tools.t.typed(1, 2)), await m(tools.t.typed()), await m(tools.t.typed({ id: 1, extra: 2 })),
       await m(tools.t.nope({})), await m(tools.zz.nope({})), await m(tools.t.echo({ deny: true })), await m(tools.t.fail({}))]`,
  },
  {
    code: `const t = (f) => { try { return ['ok', f().items.length] } catch (e) { return [e.name, e.message] } }
     return [t(() => search({ limit: -1 })), t(() => search(1, 2)), t(() => search({ query: 5 })),
       await tools.search({ limit: 'x' }).then((r) => r.items.length, (e) => [e.name, e.message])]`,
  },
  { code: `await tools.t.typed({ id: 1 }); await tools.t.typed({ id: 'x' }).catch(() => 0); await tools.t.echo({ deny: true }).catch(() => 0); await tools.t.fail({}).catch(() => 0); return 1` },
  {
    code: `const r = []; for (const input of [{ id: 'x' }, { id: 1 }, { id: 'y' }, { id: 2 }, { id: 3 }]) r.push(await tools.t.typed(input).then((v) => v, (e) => [e.name, e.message])); return r`,
    maxToolCalls: 2,
  },
  {
    code: `const r = []; r.push(await tools.t.echo({ deny: true }).catch((e) => e.message)); r.push(await tools.t.typed({ id: 1 })); r.push(await tools.t.typed({ id: 2 }).catch((e) => e.message)); return r`,
    maxToolCalls: 2,
  },
  { code: `const ps = [tools.t.typed({ id: 'x' }), tools.t.typed({ id: 1 }), tools.t.typed({ id: 2 })]; return await Promise.allSettled(ps).then((r) => r.map((x) => x.status))`, maxToolCalls: 1 },
  { code: `tools.t.typed({ id: 'x' }); return 1` },
  { code: `await tools.t.typed({ id: 'x' }); return 1` },
]

const record = async (c: { code: string; maxToolCalls?: number }) => {
  const log: Array<unknown> = []
  const result = await Effect.runPromise(runtime(log, c.maxToolCalls).execute(c.code))
  return {
    ...c,
    outcome: result.ok
      ? { ok: true, value: result.value }
      : { ok: false, kind: result.error.kind, message: result.error.message },
    toolCalls: result.toolCalls.map((call: { name: string }) => call.name),
    log,
  }
}

const recorded = []
for (const c of cases) recorded.push(await record(c))
writeRecording(join(import.meta.dir, "tools.json"), { cases: recorded })
console.log(`${recorded.length} cases`)
