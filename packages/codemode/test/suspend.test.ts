import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect, Fiber, Schema, Scope } from "effect"
import { CodeMode, Extension, Tool } from "../src/index.js"

// Suspending a run, saving its state, and resuming it in a brand-new runtime.

const Value = Schema.Struct({ value: Schema.Number })

/** Starts a program, or resumes one, in a scope of its own that outlives the test's Effects. */
const start = <E>(started: Effect.Effect<CodeMode.Execution, E, Scope.Scope>) => {
  const execution = Effect.runFork(Scope.provide(Scope.makeUnsafe())(started))
  return {
    result: Effect.flatMap(Fiber.join(execution), (running) => running.result),
    suspend: Effect.flatMap(Fiber.join(execution), (running) => running.suspend),
  }
}

/** Why resuming a state fails. */
const refusal = (resumed: Effect.Effect<CodeMode.Execution, CodeMode.SnapshotError, Scope.Scope>) =>
  Effect.runPromise(Effect.flip(Effect.scoped(resumed)))

/** A promise and its resolver, for host work a test finishes by hand. */
const latch = <A = void>() => {
  let resolve!: (value: A) => void
  const promise = new Promise<A>((done) => (resolve = done))
  return { promise, resolve }
}

/** A tool that announces each call and waits for the test to answer it. */
const manual = (options: { retry?: "safe" | "unsafe" } = {}) => {
  const calls: Array<{ input: number; answer: (value: number) => void }> = []
  let called = latch()
  const tool = Tool.make({
    description: "Waits for the test",
    input: Value,
    output: Value,
    ...options,
    execute: (input) =>
      Effect.promise(() => {
        const answer = latch<number>()
        calls.push({ input: input.value, answer: answer.resolve })
        called.resolve()
        return answer.promise.then((value) => ({ value }))
      }),
  })
  return {
    tool,
    calls,
    called: () => called.promise,
    reset: () => {
      called = latch()
    },
  }
}

/** A durable tool over an in-memory job table that outlives any one run, as a process supervisor would. */
const durableJobs = (options: { startHangs?: boolean } = {}) => {
  const jobs = new Map<string, { input: number; result: ReturnType<typeof latch<number>>; cancelled: boolean }>()
  const log: Array<string> = []
  let started = latch()
  const tool = Tool.make({
    description: "Runs a job",
    input: Value,
    output: Value,
    durable: {
      start: (input, { key }) =>
        Effect.gen(function* () {
          log.push(`start ${key}`)
          jobs.set(key, { input: input.value, result: latch<number>(), cancelled: false })
          started.resolve()
          if (options.startHangs) yield* Effect.never
          return { job: key }
        }),
      attach: (handle) =>
        Effect.promise(() => {
          const key = (handle as { job: string }).job
          log.push(`attach ${key}`)
          return jobs.get(key)!.result.promise.then((value) => ({ value }))
        }),
      lookup: (key) =>
        Effect.sync(() => {
          log.push(`lookup ${key}`)
          return jobs.has(key) ? { job: key } : undefined
        }),
      cancel: (handle) =>
        Effect.sync(() => {
          const key = (handle as { job: string }).job
          log.push(`cancel ${key}`)
          jobs.get(key)!.cancelled = true
        }),
    },
  })
  return {
    tool,
    jobs,
    log,
    started: () => started.promise,
    finish: (key: string, value: number) => jobs.get(key)!.result.resolve(value),
    reset: () => {
      started = latch()
    },
  }
}

const suspendedOf = (outcome: CodeMode.Result | CodeMode.Suspended): CodeMode.Suspended => {
  if (outcome.ok !== "suspended") throw new Error(`expected a suspended run, got ${JSON.stringify(outcome)}`)
  return outcome
}

describe("suspend and resume", () => {
  test("a run suspended at a tool call resumes in a fresh runtime, from the state or its bytes", async () => {
    const first = manual()
    const code = `
      const log = []
      log.push("before")
      const a = await tools.slow({ value: 1 })
      log.push("after " + a.value)
      console.log("resumed")
      return { log, total: a.value + 1 }`
    const run = start(CodeMode.make({ tools: { slow: first.tool } }).execute(code, undefined, { runId: "run-1" }))
    const fiber = Effect.runFork(run.result)
    await first.called()
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    // The run's own result is the same saved state.
    expect(suspendedOf(await Effect.runPromise(Fiber.join(fiber)))).toBe(suspended)
    expect(suspended.pending).toEqual([
      { id: 0, path: "slow", args: [{ value: 1 }], key: "run-1:0", status: "starting" },
    ])

    const bytes = CodeMode.toBytes(suspended.state)
    for (const state of [suspended.state, bytes] as const) {
      const outcome = await Effect.runPromise(
        start(
          CodeMode.make({ tools: { slow: first.tool } }).resume(state, {
            "run-1:0": { ok: true, value: { value: 41 } },
          }),
        ).result,
      )
      expect(outcome).toEqual({
        ok: true,
        value: { log: ["before", "after 41"], total: 42 },
        logs: ["resumed"],
        toolCalls: [{ name: "slow" }],
      })
    }
  })

  test("a run saved to a file resumes in another process", async () => {
    const first = manual()
    const run = start(
      CodeMode.make({ tools: { slow: first.tool } }).execute(`
      const seen = new Map([["first", await tools.slow({ value: 10 })]])
      const second = await tools.slow({ value: 21 })
      return [seen.get("first").value, second.value]`),
    )
    Effect.runFork(run.result)
    await first.called()
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    const file = path.join(tmpdir(), `codemode-${crypto.randomUUID()}.state`)
    await Bun.write(file, CodeMode.toBytes(suspended.state))
    try {
      const child = Bun.spawn(
        ["bun", path.join(import.meta.dir, "fixtures/resume-process.ts"), file, suspended.pending[0]!.key],
        {
          stdout: "pipe",
          stderr: "inherit",
        },
      )
      const output = await new Response(child.stdout).text()
      expect(await child.exited).toBe(0)
      expect(JSON.parse(output)).toEqual({ ok: true, value: [20, 42], toolCalls: [{ name: "slow" }, { name: "slow" }] })
    } finally {
      await Bun.file(file).delete()
    }
  })

  test("a suspend before the run starts saves its initial state", async () => {
    const runtime = CodeMode.make({ tools: {} })
    const suspended = suspendedOf(
      await Effect.runPromise(
        Effect.scoped(
          Effect.flatMap(
            runtime.execute(`let n = 0; for (let i = 0; i < 10; i++) n += i; return n`),
            (run) => run.suspend,
          ),
        ),
      ),
    )
    expect(suspended.pending).toEqual([])
    expect(await Effect.runPromise(start(runtime.resume(suspended.state)).result)).toEqual({
      ok: true,
      value: 45,
      toolCalls: [],
    })
  })

  test("a suspended durable tool's work keeps running and is reattached by its handle", async () => {
    const jobs = durableJobs()
    const runtime = CodeMode.make({ tools: { job: jobs.tool } })
    const run = start(
      runtime.execute(`const r = await tools.job({ value: 2 }); return r.value * 10`, undefined, {
        runId: "d",
      }),
    )
    Effect.runFork(run.result)
    await jobs.started()
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    expect(suspended.pending).toEqual([{ id: 0, path: "job", args: [{ value: 2 }], key: "d:0", status: "started" }])
    // Detached, not cancelled: the work finishes while nothing waits on it.
    expect(jobs.jobs.get("d:0")!.cancelled).toBe(false)
    jobs.finish("d:0", 7)
    const outcome = await Effect.runPromise(
      start(CodeMode.make({ tools: { job: jobs.tool } }).resume(CodeMode.toBytes(suspended.state))).result,
    )
    expect(outcome).toEqual({ ok: true, value: 70, toolCalls: [{ name: "job" }] })
    expect(jobs.log).toEqual(["start d:0", "attach d:0", "attach d:0"])
  })

  test("a durable call saved before its start returned is found by key, or started again", async () => {
    for (const found of [true, false]) {
      const jobs = durableJobs({ startHangs: true })
      const run = start(
        CodeMode.make({ tools: { job: jobs.tool }, suspend: { graceMs: 0 } }).execute(
          `return (await tools.job({ value: 3 })).value`,
          undefined,
          { runId: "c" },
        ),
      )
      Effect.runFork(run.result)
      await jobs.started()
      const suspended = suspendedOf(await Effect.runPromise(run.suspend))
      expect(suspended.pending.map((call) => call.status)).toEqual(["starting"])
      // As if the host crashed after start launched the work but before the run was saved again.
      if (!found) jobs.jobs.clear()
      const fresh = durableJobs()
      fresh.jobs.set("c:0", jobs.jobs.get("c:0") ?? { input: 3, result: latch<number>(), cancelled: false })
      if (!found) fresh.jobs.clear()
      const resumed = start(CodeMode.make({ tools: { job: fresh.tool } }).resume(suspended.state))
      const result = Effect.runPromise(resumed.result)
      if (!found) await fresh.started()
      fresh.finish("c:0", found ? 5 : 6)
      expect(await result).toEqual({ ok: true, value: found ? 5 : 6, toolCalls: [{ name: "job" }] })
      expect(fresh.log).toEqual(found ? ["lookup c:0", "attach c:0"] : ["lookup c:0", "start c:0", "attach c:0"])
    }
  })

  test("a call in flight when suspended re-runs when safe to retry, and otherwise rejects catchably", async () => {
    const code = `
      try {
        return { value: (await tools.work({ value: 4 })).value }
      } catch (error) {
        return { caught: String(error) }
      }`
    for (const retry of ["safe", "unsafe"] as const) {
      const first = manual({ retry })
      const run = start(
        CodeMode.make({ tools: { work: first.tool }, suspend: { graceMs: 0 } }).execute(code, undefined, {
          runId: "r",
        }),
      )
      Effect.runFork(run.result)
      await first.called()
      const suspended = suspendedOf(await Effect.runPromise(run.suspend))
      expect(suspended.pending.map((call) => [call.key, call.status])).toEqual([["r:0", "starting"]])
      const second = manual({ retry })
      const result = Effect.runPromise(
        start(CodeMode.make({ tools: { work: second.tool } }).resume(suspended.state)).result,
      )
      if (retry === "safe") {
        await second.called()
        expect(second.calls[0]!.input).toBe(4)
        second.calls[0]!.answer(9)
        expect(await result).toEqual({ ok: true, value: { value: 9 }, toolCalls: [{ name: "work" }] })
        continue
      }
      expect(second.calls).toEqual([])
      expect(await result).toEqual({
        ok: true,
        value: {
          caught:
            "Error: The call to work was interrupted when the run was suspended and may have partially run; check its effects before calling it again.",
        },
        toolCalls: [{ name: "work" }],
      })
    }
  })

  test("calls of every kind settle at a suspend inside Promise.all", async () => {
    const quick = Tool.make({
      description: "Answers at once",
      input: Value,
      output: Value,
      execute: (input) => Effect.succeed({ value: input.value * 100 }),
    })
    const slow = manual()
    const safe = manual({ retry: "safe" })
    const jobs = durableJobs()
    const tools = { quick, slow: slow.tool, safe: safe.tool, job: jobs.tool }
    const code = `
      const settled = await Promise.allSettled([
        tools.quick({ value: 1 }),
        tools.slow({ value: 2 }),
        tools.safe({ value: 3 }),
        tools.job({ value: 4 }),
      ])
      return settled.map((item) => item.status === "fulfilled" ? item.value.value : String(item.reason))`
    const run = start(CodeMode.make({ tools, suspend: { graceMs: 20 } }).execute(code, undefined, { runId: "m" }))
    Effect.runFork(run.result)
    await Promise.all([slow.called(), safe.called(), jobs.started()])
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    // The quick call finished within the grace period, so its outcome is part of the state.
    expect(suspended.pending.map((call) => [call.path, call.status])).toEqual([
      ["slow", "starting"],
      ["safe", "starting"],
      ["job", "started"],
    ])
    safe.reset()
    const result = Effect.runPromise(start(CodeMode.make({ tools }).resume(CodeMode.toBytes(suspended.state))).result)
    await safe.called()
    safe.calls[1]!.answer(30)
    jobs.finish("m:3", 40)
    expect(await result).toMatchObject({
      ok: true,
      value: [
        100,
        "Error: The call to slow was interrupted when the run was suspended and may have partially run; check its effects before calling it again.",
        30,
        40,
      ],
    })
  })

  test("active time and tool calls count across resumes", async () => {
    const first = manual()
    const runtime = CodeMode.make({ tools: { slow: first.tool }, limits: { timeoutMs: 400, maxToolCalls: 1 } })
    const run = start(
      runtime.execute(`
      let n = 0
      const started = Date.now()
      while (Date.now() - started < 150) n++
      await tools.slow({ value: 1 })
      await tools.slow({ value: 2 })
      return n`),
    )
    Effect.runFork(run.result)
    await first.called()
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    expect(suspended.state.header.budget.activeMs).toBeGreaterThanOrEqual(150)
    expect(suspended.state.header.budget.toolCalls).toBe(1)
    // The second call is over the limit the first one used up before the suspend.
    const resumed = await Effect.runPromise(
      start(runtime.resume(suspended.state, { [suspended.pending[0]!.key]: { ok: true, value: { value: 1 } } })).result,
    )
    expect(resumed).toMatchObject({ ok: false, error: { kind: "ToolCallLimitExceeded" } })

    const busy = CodeMode.make({ tools: { slow: first.tool }, limits: { timeoutMs: 300 } })
    first.reset()
    const spin = start(
      busy.execute(`
      const started = Date.now()
      while (Date.now() - started < 200) {}
      await tools.slow({ value: 1 })
      const again = Date.now()
      while (Date.now() - again < 200) {}
      return "done"`),
    )
    Effect.runFork(spin.result)
    await first.called()
    const paused = suspendedOf(await Effect.runPromise(spin.suspend))
    // 200ms were used before the suspend; the next 200ms of work go past the 300ms limit.
    const timedOut = await Effect.runPromise(
      start(busy.resume(paused.state, { [paused.pending[0]!.key]: { ok: true, value: { value: 1 } } })).result,
    )
    expect(timedOut).toMatchObject({ ok: false, error: { kind: "TimeoutExceeded" } })
  })

  test("a function an extension returned is lost on resume, and calling it fails clearly", async () => {
    const extension = Extension.make({
      name: "maker",
      globals: {
        make: () =>
          function inc(x: number) {
            return x + 1
          },
      },
    })
    const first = manual()
    const runtime = CodeMode.make({ tools: { slow: first.tool }, extensions: [extension] })
    const run = start(
      runtime.execute(`
      const inc = make()
      const before = inc(1)
      await tools.slow({ value: 0 })
      try {
        return { before, after: inc(1) }
      } catch (error) {
        return { before, error: String(error) }
      }`),
    )
    Effect.runFork(run.result)
    await first.called()
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    const outcome = await Effect.runPromise(
      start(
        CodeMode.make({ tools: { slow: first.tool }, extensions: [extension] }).resume(suspended.state, {
          [suspended.pending[0]!.key]: { ok: true, value: { value: 0 } },
        }),
      ).result,
    )
    expect(outcome).toMatchObject({
      ok: true,
      value: {
        before: 2,
        error:
          "TypeError: The function inc came from the host and was lost when the run was suspended; get it again after resuming.",
      },
    })
  })

  test("a durable call the program leaves running is cancelled when it ends", async () => {
    const jobs = durableJobs()
    const outcome = await Effect.runPromise(
      start(
        CodeMode.make({ tools: { job: jobs.tool } }).execute(`tools.job({ value: 1 }); return "left"`, undefined, {
          runId: "e",
        }),
      ).result,
    )
    expect(outcome).toMatchObject({ ok: true, value: "left" })
    expect(jobs.jobs.get("e:0")!.cancelled).toBe(true)
  })

  test("tools and hooks see each call's idempotency key, the same at both hooks of a durable call", async () => {
    const jobs = durableJobs()
    const keys: Array<string> = []
    const echo = Tool.make({
      description: "Echoes its key",
      input: Schema.Struct({}),
      output: Schema.String,
      execute: (_, { key }) => Effect.succeed(key),
    })
    const runtime = CodeMode.make({
      tools: { echo, job: jobs.tool },
      hooks: {
        "tool.before": (call) => Effect.sync(() => void keys.push(`before ${call.name} ${call.key}`)),
        "tool.after": (call) => Effect.sync(() => void keys.push(`after ${call.name} ${call.key}`)),
      },
    })
    const run = start(
      runtime.execute(
        `const job = tools.job({ value: 1 }); const key = await tools.echo({}); return [key, (await job).value]`,
        undefined,
        {
          runId: "k",
        },
      ),
    )
    const fiber = Effect.runFork(run.result)
    await jobs.started()
    jobs.finish("k:0", 7)
    expect(await Effect.runPromise(Fiber.join(fiber))).toMatchObject({ ok: true, value: ["k:1", 7] })
    expect(keys.toSorted()).toEqual(["after echo k:1", "after job k:0", "before echo k:1", "before job k:0"])
  })

  test("tool.after sees a durable call that ends with its run as interrupted, but not one detached to suspend", async () => {
    const jobs = durableJobs()
    const events: Array<string> = []
    const hooks = {
      "tool.after": (call: CodeMode.ToolInvocation, result: CodeMode.CallResult) =>
        Effect.sync(() => void events.push(`${call.key} ${result.status}`)),
    }
    const ended = await Effect.runPromise(
      start(
        CodeMode.make({ tools: { job: jobs.tool }, hooks }).execute(`tools.job({ value: 1 }); return 1`, undefined, {
          runId: "a",
        }),
      ).result,
    )
    expect(ended).toMatchObject({ ok: true })
    expect(events).toEqual(["a:0 interrupted"])

    events.length = 0
    jobs.reset()
    const run = start(
      CodeMode.make({ tools: { job: jobs.tool }, hooks }).execute(
        `return (await tools.job({ value: 2 })).value`,
        undefined,
        {
          runId: "b",
        },
      ),
    )
    Effect.runFork(run.result)
    await jobs.started()
    await Bun.sleep(5)
    const suspended = await Effect.runPromise(run.suspend)
    expect(suspended).toMatchObject({ ok: "suspended", pending: [{ key: "b:0", status: "started" }] })
    expect(events).toEqual([])
  })

  test("the snapshot codec does not import Effect", async () => {
    for (const file of ["codec.ts", "snapshot.ts"]) {
      expect(await Bun.file(`${import.meta.dir}/../src/snapshot/${file}`).text()).not.toMatch(/from "effect"/)
    }
  })

  test("a state is refused by another build, other extensions, or a changed source", async () => {
    const first = manual()
    const runtime = CodeMode.make({ tools: { slow: first.tool } })
    const run = start(runtime.execute(`await tools.slow({ value: 1 }); return 1`))
    Effect.runFork(run.result)
    await first.called()
    const state = suspendedOf(await Effect.runPromise(run.suspend)).state
    const header = state.header
    expect((await refusal(runtime.resume({ ...state, header: { ...header, build: "0.0.0+0" } }))).message).toMatch(
      /saved by another Code Mode build \(0\.0\.0\+0\)/,
    )
    const other = CodeMode.make({ extensions: [Extension.make({ name: "x", globals: { f: () => 1 } })] })
    expect((await refusal(other.resume(state))).message).toMatch("saved by a runtime with other host globals")
    const source = header.sources[0]!
    expect(
      (
        await refusal(
          runtime.resume({ ...state, header: { ...header, sources: [{ ...source, code: `${source.code} ` }] } }),
        )
      ).message,
    ).toBe("Source main does not match its hash.")
    expect(await refusal(runtime.resume(new TextEncoder().encode("{")))).toBeInstanceOf(CodeMode.SnapshotError)
    expect((await refusal(runtime.resume({ ...state, records: [{ t: "Nope" }] }))).message).toMatch("Invalid snapshot")
  })

  test("a state over the byte budget fails the run instead of suspending it", async () => {
    const first = manual()
    const run = start(
      CodeMode.make({ tools: { slow: first.tool }, suspend: { maxBytes: 100 } }).execute(
        `const big = "x".repeat(1000); await tools.slow({ value: 1 }); return big.length`,
      ),
    )
    Effect.runFork(run.result)
    await first.called()
    expect(await Effect.runPromise(run.suspend)).toMatchObject({
      ok: false,
      error: { kind: "ExecutionFailure", message: expect.stringContaining("more than the 100-byte limit") },
    })
  })

  test("program state of every kind survives a suspend", async () => {
    const first = manual()
    const code = `
      const shared = { n: 1 }
      const map = new Map([[shared, "a"], ["k", shared]])
      const set = new Set([1, shared])
      const it = map.keys()
      it.next()
      const url = new URL("https://example.com/a?x=1")
      const params = url.searchParams
      const bytes = new Uint8Array([1, 2, 3, 4])
      const view = bytes.subarray(1, 3)
      const re = /a(b)/g
      re.test("abab")
      const date = new Date(0)
      const weak = new WeakMap([[shared, 5]])
      function* counter() { let i = 0; while (true) yield i++ }
      const gen = counter()
      gen.next()
      const bound = ((a, b) => a + b).bind(null, 10)
      const sparse = []
      sparse[5000] = "far"
      const pending = new Promise((resolve) => (globalResolve = resolve))
      var globalResolve
      Array.prototype.extra = "patched"
      await tools.slow({ value: 1 })
      params.append("y", "2")
      view[0] = 9
      globalResolve("later")
      return {
        same: map.get("k") === shared && set.has(shared) && weak.get(shared) === 5,
        next: it.next().value,
        url: url.href,
        bytes: [...bytes],
        lastIndex: re.lastIndex,
        date: date.getTime(),
        gen: [gen.next().value, gen.next().value],
        bound: bound(5),
        sparse: [sparse.length, sparse[5000], 4999 in sparse],
        pending: await pending,
        extra: [].extra,
        negative: Object.is(-0, -0 * 1),
      }`
    const run = start(CodeMode.make({ tools: { slow: first.tool } }).execute(code))
    Effect.runFork(run.result)
    await first.called()
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    const outcome = await Effect.runPromise(
      start(
        CodeMode.make({ tools: { slow: first.tool } }).resume(CodeMode.toBytes(suspended.state), {
          [suspended.pending[0]!.key]: { ok: true, value: { value: 1 } },
        }),
      ).result,
    )
    expect(outcome).toMatchObject({
      ok: true,
      value: {
        same: true,
        next: "k",
        url: "https://example.com/a?x=1&y=2",
        bytes: [1, 9, 3, 4],
        lastIndex: 2,
        date: 0,
        gen: [1, 2],
        bound: 15,
        sparse: [5001, "far", false],
        pending: "later",
        extra: "patched",
        negative: true,
      },
    })
  })
})
