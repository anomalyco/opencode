#!/usr/bin/env bun

// Regenerates conformance/host.json: what the reference's language layer does with host functions, the behaviours
// packages/codemode/test/language.test.ts covers that the other recordings don't: call keys and run ids, sync, async
// and sync-thenable functions, constructible ones, functions that take functions, idempotent calls across a suspend,
// durable functions across a suspend (start, wait, cancel), `Host.fail` and `Host.missing` kinds and suggestions,
// namespaces (keys, resolve), `run.metadata` across a suspend and in the result, globals made again on resume,
// `translate` (default "error" and its modes) and `limits`. The Rust tests replay this recording.
// Usage: bun conformance/host.ts [reference] — the reference CodeMode package directory, from the argument,
// CODEMODE_REF, or by default ../codemode relative to this workspace.
//
// Every entry runs in its own runtime: `Runtime.make({ globals, translate?, limits? })` with the entry's `translate`
// and `limits` (absent: the reference's defaults, both translations "error" and no limits), no `modules`, and the
// program made with `{ runId }` (the entry's, "run" by default). `globals(run)` is called when a run starts and again
// when it resumes; each call counts toward the entry's `made`. It gives (every `run` takes one parameter, `length` 1,
// except `note`, `post` and the durable function's hooks, which also take the call; each is named by its global):
// - `double(n)`: sync; gives `n * 2`.
// - `inc(n)`: sync; gives `Effect.succeed(n + 1)`, which the program waits for.
// - `promised(n)`: sync; gives `Promise.resolve(n)`, which reaches the program as a promise.
// - `load(n)`: async; gives `Effect.succeed(n)`.
// - `find()`: sync-thenable; gives `{ items: [1, 2] }`.
// - `note(...args)`: sync; logs `["note", call.key, args.map(describe)]` (see `describe` in conformance/reference.ts)
//   and gives `undefined`.
// - `post(...args)`: async; logs `["post", call.key, args.map(describe)]` as it runs and gives `undefined`.
// - `never()`: async, not idempotent; logs `["never", call.key]` and never settles.
// - `open()`: sync; gives `{ read }`, where `read` is a host function (a plain JavaScript function inside a result)
//   that gives `"called"`.
// - `takes(input)`: sync, `takesFunctions: true`; gives whether `input.read` is that same `read` function.
// - `refuses(input)`: sync; gives `true`.
// - `grab(input)`: async, `idempotent: true`, `takesFunctions: true`; logs `["grab", call.key]`; never settles until the entry
//   resumed, then gives 3.
// - `Box(item)`: sync, `constructible: true`; gives `{ item }`.
// - `Later(item)`: sync, `constructible: true`; gives `Effect.succeed({ item })`.
// - `refuse()`: sync; fails with `Host.fail("Refused", "Not today", ["Ask again."])`.
// - `api`: `Host.namespace`; `keys([])` is `["issues"]`, `keys` of any other path `["list"]`; `resolve(["issues",
//   "list"])` is an async function giving `["#1"]`, any other path `Host.missing("No api.<path>", ["Try
//   api.issues.list."], "NotFound")`.
// - `count()`: sync; sets `run.metadata` to `{ count: 0 }` when it is null, then increments and gives `count`.
// - `wait()`: async, `idempotent: true`; logs `["wait", call.key]`; never settles until the entry resumed, then gives 7.
// - `job()`: `Host.durableFn`. `start(args, call)` logs `["job.start", call.key, args.map(describe)]` and gives
//   `call.key` as its data; `wait(data, call)` logs `["job.wait", data, call.key, call.args.map(describe)]`, never
//   settles until the entry resumed, then gives 41; `cancel(data, call)` logs `["job.cancel", data, call.key]`.
//
// host.json: `{ executes: [{ code, runId, translate?, limits?, outcome, log }], suspensions: [{ code, runId,
// translate?, limits?, suspend, resume?, made, log }] }`.
// - `outcome` and `resume`: the run's `Result` as the reference gives it (`ok`, `value` or `error` with `kind`,
//   `message` and `suggestions?`, `warnings?`, `logs?`, `truncated?`, `metadata`).
// - A suspension runs the program until `never`, `grab`, `wait` or the durable `job`'s `wait` is first called,
//   suspends it (`program.suspend()`), then: on a `SuspendError`, records `suspend: { ok: false, message, running }`
//   and interrupts the run; on success, records `suspend: { ok: true, metadata, same }` (the saved header's
//   `metadata`; `same`: whether `run()` returned that same `Suspended`), marks the entry resumed, and resumes the
//   state from bytes (`Language.toBytes`) in the same runtime. `made` counts `globals` calls (the reference's normal
//   mode; its round-trip test mode makes them more often).
// - `log`: what the host functions logged, in order.
// Everything is recorded twice, and a difference between the two fails the generator.

import { join } from "node:path"
import { writeRecording } from "./recording.ts"
import { describe, reference } from "./reference.ts"

const ref = await reference(process.argv[2] ?? process.env.CODEMODE_REF)
const Effect = ref.Effect
const Fiber = ref.Fiber
const Host = ref.Language.Host
const Runtime = ref.Language.Runtime

type Entry = { code: string; runId?: string; translate?: unknown; limits?: unknown }

const read = () => "called"

const make = (entry: Entry) => {
  const log: Array<unknown> = []
  const state = { resumed: false, made: 0, started: () => {} }
  const waiting = new Promise<void>((done) => (state.started = done))
  const pending = () => Effect.callback<never>(() => state.started())
  const runtime = Runtime.make({
    ...(entry.translate === undefined ? {} : { translate: entry.translate }),
    ...(entry.limits === undefined ? {} : { limits: entry.limits }),
    globals: (run: { id: string; metadata: unknown }) => {
      state.made++
      return {
        double: Host.fn(([n]: ReadonlyArray<number>) => n * 2),
        inc: Host.fn(([n]: ReadonlyArray<number>) => Effect.succeed(n + 1)),
        promised: Host.fn(([n]: ReadonlyArray<number>) => Promise.resolve(n)),
        load: Host.fn(([n]: ReadonlyArray<unknown>) => Effect.succeed(n), { type: "async" }),
        find: Host.fn((_: ReadonlyArray<unknown>) => ({ items: [1, 2] }), { type: "sync-thenable" }),
        note: Host.fn((args: ReadonlyArray<unknown>, call: { key: string }) => {
          log.push(["note", call.key, args.map(describe)])
        }),
        post: Host.fn(
          (args: ReadonlyArray<unknown>, call: { key: string }) =>
            Effect.sync(() => void log.push(["post", call.key, args.map(describe)])),
          { type: "async" },
        ),
        never: Host.fn(
          (_: ReadonlyArray<unknown>, call: { key: string }) =>
            Effect.suspend(() => (log.push(["never", call.key]), pending())),
          { type: "async" },
        ),
        open: Host.fn((_: ReadonlyArray<unknown>) => ({ read })),
        takes: Host.fn(([input]: ReadonlyArray<{ read?: unknown }>) => input?.read === read, { takesFunctions: true }),
        refuses: Host.fn((_: ReadonlyArray<unknown>) => true),
        grab: Host.fn(
          (_: ReadonlyArray<unknown>, call: { key: string }) =>
            Effect.suspend(() => (log.push(["grab", call.key]), state.resumed ? Effect.succeed(3) : pending())),
          { type: "async", idempotent: true, takesFunctions: true },
        ),
        Box: Host.fn(([item]: ReadonlyArray<unknown>) => ({ item }), { constructible: true }),
        Later: Host.fn(([item]: ReadonlyArray<unknown>) => Effect.succeed({ item }), { constructible: true }),
        refuse: Host.fn((_: ReadonlyArray<unknown>) => Effect.fail(Host.fail("Refused", "Not today", ["Ask again."]))),
        api: Host.namespace({
          keys: (path: ReadonlyArray<string>) => (path.length === 0 ? ["issues"] : ["list"]),
          resolve: (path: ReadonlyArray<string>) =>
            path.join(".") === "issues.list"
              ? Host.fn((_: ReadonlyArray<unknown>) => Effect.succeed(["#1"]), { type: "async" })
              : Host.missing(`No api.${path.join(".")}`, ["Try api.issues.list."], "NotFound"),
        }),
        count: Host.fn((_: ReadonlyArray<unknown>) => {
          const counted = (run.metadata ??= { count: 0 }) as { count: number }
          return ++counted.count
        }),
        wait: Host.fn(
          (_: ReadonlyArray<unknown>, call: { key: string }) =>
            Effect.suspend(() => {
              log.push(["wait", call.key])
              return state.resumed ? Effect.succeed(7) : pending()
            }),
          { type: "async", idempotent: true },
        ),
        job: Host.durableFn({
          start: (args: ReadonlyArray<unknown>, call: { key: string }) =>
            Effect.sync(() => {
              log.push(["job.start", call.key, args.map(describe)])
              return call.key
            }),
          wait: (data: unknown, call: { key: string; args: ReadonlyArray<unknown> }) =>
            Effect.suspend(() => {
              log.push(["job.wait", data, call.key, call.args.map(describe)])
              return state.resumed ? Effect.succeed(41) : pending()
            }),
          cancel: (data: unknown, call: { key: string }) =>
            Effect.sync(() => void log.push(["job.cancel", data, call.key])),
        }),
      }
    },
  })
  return { runtime, log, state, waiting }
}

const named = (entry: Entry) => ({ ...entry, runId: entry.runId ?? "run" })

const execute = async (entry: Entry) => {
  const made = make(entry)
  const result = await Effect.runPromise(made.runtime.execute(entry.code, { runId: named(entry).runId }))
  return { ...named(entry), outcome: result, log: made.log }
}

const suspend = async (entry: Entry) => {
  const made = make(entry)
  const program = made.runtime.program(entry.code, { runId: named(entry).runId })
  const fiber = Effect.runFork(program.run())
  await made.waiting
  const suspended = await Effect.runPromise(Effect.result(program.suspend()))
  if (suspended._tag === "Failure") {
    await Effect.runPromise(Fiber.interrupt(fiber))
    return {
      ...named(entry),
      suspend: { ok: false, message: suspended.failure.message, running: suspended.failure.running },
      made: made.state.made,
      log: made.log,
    }
  }
  const outcome = suspended.success
  const ran = await Effect.runPromise(Fiber.join(fiber))
  if (outcome.ok !== "suspended")
    return { ...named(entry), suspend: { ok: false, outcome }, made: made.state.made, log: made.log }
  made.state.resumed = true
  const resumed = await Effect.runPromise(made.runtime.resume(ref.Language.toBytes(outcome.state)).run())
  return {
    ...named(entry),
    suspend: { ok: true, metadata: outcome.state.header.metadata, same: ran === outcome },
    resume: resumed,
    made: made.state.made,
    log: made.log,
  }
}

const drop = { functions: "drop" }
const wait = { promises: "await" }
const executes: Array<Entry> = [
  // Sync, async and sync-thenable functions.
  { code: `const a = double(2); const b = inc(a); return [a, b, typeof double, double.name, double.length]` },
  { code: `const p = load(1); return [p instanceof Promise, await p]` },
  { code: `const p = promised(3); return [p instanceof Promise, await p]` },
  {
    code: `return [find().items.length, (await find()).items.length, await find().then((r) => r.items[1]), Object.keys(find())]`,
  },
  {
    code: `const log = []; load(1).then(() => log.push("load")); promised(2).then(() => log.push("promised")); Promise.resolve().then(() => log.push("job")); log.push(inc(1)); await null; await null; await null; return log`,
  },
  // Call keys: every call of a host function takes the next id, in program order.
  { code: `note(); note(1); await load(1); note("a", [2]); await post(3); return 1`, runId: "r" },
  {
    code: `const p = post(1); note(2); const q = Promise.all([post(3), load(4)]); note(5); await p; await q; return 1`,
    runId: "k",
  },
  // Arguments and results cross as structured copies.
  {
    code: `note({ at: new Date(5), m: new Map([["k", 1]]), s: new Set(["a"]), u: new URL("https://a.test/"), e: new RangeError("r") }); const r = open(); return [typeof r.read, r.read(), r.read.name]`,
  },
  // A function inside a result crosses back as itself only to a function that takes functions.
  { code: `return takes({ read: open().read })` },
  { code: `return takes(open())` },
  { code: `refuses(open().read)` },
  { code: `takes(takes)` },
  { code: `takes(() => 1)` },
  // Constructible functions.
  { code: `return [new Box(1).item, new Later(2).item, new Later(...[3]).item, Box(4).item, typeof Box]` },
  { code: `new double(1)` },
  { code: `try { new load(1) } catch (e) { return [e.name, e.message] }` },
  // Namespaces, Host.missing and Host.fail.
  {
    code: `return [await api.issues.list(), Object.keys(api), Object.keys(api.issues), typeof api.x, typeof api.issues.list]`,
  },
  { code: `return api.issues.nope()` },
  { code: `try { api.nope() } catch (e) { return [e.name, e.message, e instanceof Error] }` },
  { code: `refuse()` },
  { code: `try { refuse() } catch (e) { return [e.name, e.message] }` },
  {
    code: `const out = []; for (const k in api) out.push(k); const x = api.issues; return [out, api.issues === api.issues, x === x, String(api.issues)]`,
  },
  // run.metadata is the result's.
  { code: `count(); count(); return count()` },
  { code: `return 1` },
  { code: `count(); throw new Error("after")` },
  // Translate: the default refuses functions and promises in arguments.
  { code: `note({ f() {} })` },
  { code: `note([Promise.resolve(1)])` },
  { code: `await post(() => 1)` },
  { code: `return await post({ p: Promise.resolve(1) }).catch((e) => [e.name, e.message])` },
  // functions: "drop".
  {
    code: `note({ q: "x", format(v) { return v }, nested: { f: Math.max } }, [1, () => 2, note], () => 3, new Map([["k", () => 1]]))`,
    translate: drop,
  },
  { code: `note({ p: Promise.resolve(1) })`, translate: drop },
  // promises: "await".
  {
    code: `const slow = (async () => { await null; await null; return "slow" })()
const a = note({ n: Promise.resolve(5), list: [load(1), slow] }, load({ deep: load(2) }))
const b = await post(slow, new Promise((resolve) => resolve(load(3))))
return [a, b]`,
    translate: wait,
  },
  { code: `note({ f() {} })`, translate: wait },
  {
    code: `const failing = () => Promise.reject(new RangeError("nope"))
let thrown
try { note({ n: failing() }) } catch (error) { thrown = error }
const sent = post([load(1), failing()])
return [thrown instanceof RangeError, thrown.message, sent instanceof Promise, await sent.catch((e) => e.message)]`,
    translate: wait,
  },
  { code: `note({ n: never() })`, translate: wait, limits: { timeoutMs: 50 } },
  { code: `note({ f() {}, p: load(1) }, () => 2)`, translate: { functions: "drop", promises: "await" } },
  // Limits.
  { code: `while (true) {}`, limits: { timeoutMs: 50 } },
  { code: `await never()`, limits: { timeoutMs: 50 } },
  { code: `never(); return 1`, limits: { timeoutMs: 50 } },
  { code: `console.log("a".repeat(10)); console.log("b"); return "c".repeat(20)`, limits: { maxOutputBytes: 16 } },
  { code: `console.log("1"); console.log("2"); console.log("3"); return 1`, limits: { maxOutputBytes: 4 } },
  { code: `count(); console.log("x".repeat(30)); throw new Error("y".repeat(30))`, limits: { maxOutputBytes: 8 } },
  { code: `for (let i = 0; i < 5; i++) Promise.reject(new Error("e" + i)); return 1`, limits: { maxOutputBytes: 100 } },
  // Warnings: rejections nothing handled.
  { code: `Promise.reject(new Error("x")); return 1` },
  { code: `const p = Promise.reject(1); await null; p.catch(() => 0); return 2` },
  { code: `async function f() { throw new TypeError("bad") }\nf(); f(); return 4` },
  { code: `Promise.reject("plain"); Promise.reject({ a: [1] }); return 6` },
  { code: `Promise.reject(new Error("unseen")); throw new Error("seen")` },
  { code: `async function g() { null.x }\ng(); return 7` },
  { code: `refuse.call(null); return 8` },
  { code: `api.issues.nope(); return 9` },
  // Durable functions: cancelled when the run ends with their work still running.
  { code: `job(1); return 1`, runId: "c" },
  { code: `const p = job({ a: 1 }); await null; throw new Error("ended")`, runId: "c" },
]
const suspensions: Array<Entry> = [
  // run.metadata across a suspend; the globals are made again on resume.
  { code: `count(); count(); await wait(); return count()`, runId: "m" },
  // An idempotent call in progress runs again on resume, under the same key.
  { code: `note(1); const a = await wait(); note(2); return [a, await wait()]`, runId: "i" },
  { code: `const ps = [wait(), load(1), wait()]; return await Promise.all(ps)`, runId: "i" },
  // A suspend fails while a call that isn't idempotent, or one that holds a host function, runs.
  { code: `await never()`, runId: "s" },
  { code: `const p = never(); await wait(); return 1`, runId: "s" },
  { code: `await grab(open().read)`, runId: "s" },
  { code: `await grab({ n: 1 })`, runId: "s" },
  // A durable function keeps running across a suspend and is waited on again.
  { code: `return (await job()) + 1`, runId: "d" },
  { code: `const a = job(1, { b: [2] }); const b = job(); return [await a, await b, count()]`, runId: "d" },
  // promises: "await" keeps waiting across a suspend.
  { code: `return [note({ n: wait() }), await wait()]`, runId: "t", translate: wait },
  // Limits are saved with the run.
  {
    code: `await wait(); console.log("x".repeat(20)); return "y".repeat(20)`,
    runId: "l",
    limits: { maxOutputBytes: 10 },
  },
]

const recordAll = async () => {
  const recorded = { executes: [] as Array<unknown>, suspensions: [] as Array<unknown> }
  for (const entry of executes) recorded.executes.push(await execute(entry))
  for (const entry of suspensions) recorded.suspensions.push(await suspend(entry))
  return recorded
}
// Everything is recorded twice: a recording that differs between the two depends on timing, which CI's freshness
// check and the Rust replay can't follow, so it fails here instead of being written.
const expected = await recordAll()
const again = await recordAll()
const unstable = (["executes", "suspensions"] as const).flatMap((kind) =>
  expected[kind].flatMap((entry, i) =>
    JSON.stringify(entry) === JSON.stringify(again[kind][i]) ? [] : [`${kind}[${i}]: ${(entry as Entry).code}`],
  ),
)
if (unstable.length > 0) {
  console.error(`recordings that differ between two runs (timing-dependent):\n${unstable.join("\n\n")}`)
  process.exit(1)
}
writeRecording(join(import.meta.dir, "host.json"), expected)
console.log(`${expected.executes.length} executes, ${expected.suspensions.length} suspensions`)
