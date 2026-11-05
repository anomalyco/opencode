import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect, Exit, Fiber, Schema, Scope } from "effect"
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

/** Why a suspend fails. */
const blocked = (execution: { readonly suspend: Effect.Effect<unknown, CodeMode.SuspendError> }) =>
  Effect.runPromise(Effect.flip(execution.suspend))

/** A promise and its resolver, for host work a test finishes by hand. */
const latch = <A = void>() => {
  let resolve!: (value: A) => void
  const promise = new Promise<A>((done) => (resolve = done))
  return { promise, resolve }
}

/** A tool that announces each call and waits for the test to answer it. */
const manual = () => {
  const calls: Array<{ input: number; answer: (value: number) => void }> = []
  let called = latch()
  const tool = Tool.make({
    description: "Waits for the test",
    input: Value,
    output: Value,
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
const durableJobs = (options: { startGate?: Promise<void> } = {}) => {
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
          if (options.startGate !== undefined) yield* Effect.promise(() => options.startGate!)
          return { job: key }
        }),
      attach: (handle) =>
        Effect.promise(() => {
          const key = (handle as { job: string }).job
          log.push(`attach ${key}`)
          return jobs.get(key)!.result.promise.then((value) => ({ value }))
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

describe("suspend", () => {
  test("a run waiting on a durable call suspends, keeps the work running, and resumes with its outcome", async () => {
    const jobs = durableJobs()
    const events: Array<string> = []
    const hooks = {
      "tool.after": (call: CodeMode.ToolInvocation, result: CodeMode.CallResult) =>
        Effect.sync(() => void events.push(`${call.key} ${result.status}`)),
    }
    const code = `
      const log = ["before"]
      const a = await tools.job({ value: 1 })
      log.push("after " + a.value)
      console.log("resumed")
      return { log, total: a.value + 1 }`
    const run = start(CodeMode.make({ tools: { job: jobs.tool }, hooks }).execute(code, undefined, { runId: "run-1" }))
    await jobs.started()
    await Bun.sleep(1)
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    // The run's own result is the same saved state.
    expect(suspendedOf(await Effect.runPromise(run.result))).toBe(suspended)
    expect(suspended.pending).toEqual([
      { key: "run-1:0", path: "tools.job", args: [{ value: 1 }], handle: { job: "run-1:0" } },
    ])
    // Detached, not cancelled, and not reported: the work runs on while nothing in the run waits on it.
    expect(jobs.jobs.get("run-1:0")!.cancelled).toBe(false)
    expect(events).toEqual([])

    for (const state of [suspended.state, CodeMode.toBytes(suspended.state)] as const) {
      const outcome = await Effect.runPromise(
        start(
          CodeMode.make({ tools: { job: jobs.tool } }).resume(state, { "run-1:0": { ok: true, value: { value: 41 } } }),
        ).result,
      )
      expect(outcome).toEqual({
        ok: true,
        value: { log: ["before", "after 41"], total: 42 },
        logs: ["resumed"],
        toolCalls: [{ name: "job" }],
      })
    }
    expect(jobs.log).toEqual(["start run-1:0", "attach run-1:0"])
  })

  test("a suspend fails while a tool, search, or an extension call is running, and the run goes on", async () => {
    const slow = manual()
    const searching = latch()
    const searched = latch()
    const fetched = latch<string>()
    const fetching = latch()
    const hookGate = latch()
    const hooked = latch()
    const extension = Extension.make({
      name: "web",
      globals: {
        fetch: async (url: string) => {
          fetching.resolve()
          return `${url} ${await fetched.promise}`
        },
        now: () => 7,
      },
    })
    const runtime = CodeMode.make({
      tools: { slow: slow.tool },
      extensions: [extension],
      hooks: {
        "tool.before": (call) =>
          call.name === "search"
            ? Effect.promise(() => {
                searching.resolve()
                return searched.promise
              })
            : Effect.void,
        "extension.before": (call) =>
          call.name === "now"
            ? Effect.promise(() => {
                hooked.resolve()
                return hookGate.promise
              })
            : Effect.void,
      },
    })
    const cases: ReadonlyArray<
      readonly [
        name: string,
        code: string,
        running: () => Promise<void>,
        release: () => void,
        path: string,
        value: unknown,
      ]
    > = [
      [
        "a tool",
        `return (await tools.slow({ value: 1 })).value`,
        slow.called,
        () => slow.calls[0]!.answer(5),
        "tools.slow",
        5,
      ],
      [
        "search",
        `return (await search({ query: "slow" })).items.length`,
        () => searching.promise,
        () => searched.resolve(),
        "search",
        1,
      ],
      [
        "an async extension function",
        `return await fetch("https://a.test/")`,
        () => fetching.promise,
        () => fetched.resolve("ok"),
        "fetch",
        "https://a.test/ ok",
      ],
      [
        "a synchronous extension function",
        `return now() + 1`,
        () => hooked.promise,
        () => hookGate.resolve(),
        "now",
        8,
      ],
    ]
    for (const [name, code, running, release, path, value] of cases) {
      const run = start(runtime.execute(code, undefined, { runId: "b" }))
      await running()
      const error = await blocked(run)
      expect(error, name).toBeInstanceOf(CodeMode.SuspendError)
      expect(error.running, name).toEqual([{ key: "b:0", path }])
      expect(error.message, name).toBe(
        `The run can't be suspended while ${path} is running; only a durable tool's started work can be.`,
      )
      release()
      expect(await Effect.runPromise(run.result), name).toMatchObject({ ok: true, value })
    }
  })

  test("a suspend fails while a durable call is still in start, and succeeds once it has its handle", async () => {
    const gate = latch()
    const jobs = durableJobs({ startGate: gate.promise })
    const run = start(
      CodeMode.make({ tools: { job: jobs.tool } }).execute(`return (await tools.job({ value: 3 })).value`, undefined, {
        runId: "c",
      }),
    )
    await jobs.started()
    expect((await blocked(run)).running).toEqual([{ key: "c:0", path: "tools.job" }])
    gate.resolve()
    await Bun.sleep(1)
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    expect(suspended.pending.map((call) => call.key)).toEqual(["c:0"])
    expect(jobs.jobs.get("c:0")!.cancelled).toBe(false)
  })

  test("every running call that blocks a suspend is named", async () => {
    const slow = manual()
    const jobs = durableJobs()
    const run = start(
      CodeMode.make({ tools: { slow: slow.tool, "a-b": { job: jobs.tool } } }).execute(
        `return await Promise.all([tools["a-b"].job({ value: 1 }), tools.slow({ value: 2 }), tools.slow({ value: 3 })])`,
        undefined,
        { runId: "n" },
      ),
    )
    await jobs.started()
    await slow.called()
    await Bun.sleep(1)
    expect((await blocked(run)).running).toEqual([
      { key: "n:1", path: "tools.slow" },
      { key: "n:2", path: "tools.slow" },
    ])
  })

  test("a suspend after the run ended gives its result", async () => {
    const run = start(CodeMode.make({}).execute(`return 1 + 1`))
    expect(await Effect.runPromise(run.result)).toEqual({ ok: true, value: 2, toolCalls: [] })
    expect(await Effect.runPromise(run.suspend)).toEqual({ ok: true, value: 2, toolCalls: [] })
  })

  test("a suspend before the program's first step saves its initial state", async () => {
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

  test("a state over the byte budget fails the suspend, and the run goes on", async () => {
    const jobs = durableJobs()
    const run = start(
      CodeMode.make({ tools: { job: jobs.tool }, suspend: { maxBytes: 100 } }).execute(
        `const big = "x".repeat(1000); await tools.job({ value: 1 }); return big.length`,
        undefined,
        { runId: "s" },
      ),
    )
    await jobs.started()
    await Bun.sleep(1)
    const error = await blocked(run)
    expect(error.running).toEqual([])
    expect(error.message).toMatch(/^The run's state takes \d+ bytes, more than the 100-byte limit/)
    jobs.finish("s:0", 1)
    expect(await Effect.runPromise(run.result)).toMatchObject({ ok: true, value: 1000 })
    expect(jobs.jobs.get("s:0")!.cancelled).toBe(false)
  })

  test("a durable call the program leaves running is cancelled when it ends, or when its scope closes", async () => {
    const jobs = durableJobs()
    const events: Array<string> = []
    const hooks = {
      "tool.after": (call: CodeMode.ToolInvocation, result: CodeMode.CallResult) =>
        Effect.sync(() => void events.push(`${call.key} ${result.status}`)),
    }
    const runtime = CodeMode.make({ tools: { job: jobs.tool }, hooks })
    const outcome = await Effect.runPromise(
      start(runtime.execute(`tools.job({ value: 1 }); return "left"`, undefined, { runId: "e" })).result,
    )
    expect(outcome).toMatchObject({ ok: true, value: "left" })
    expect(jobs.jobs.get("e:0")!.cancelled).toBe(true)
    expect(events).toEqual(["e:0 interrupted"])

    jobs.reset()
    const scope = Scope.makeUnsafe()
    await Effect.runPromise(
      Scope.provide(scope)(runtime.execute(`return (await tools.job({ value: 2 })).value`, undefined, { runId: "f" })),
    )
    await jobs.started()
    await Bun.sleep(1)
    await Effect.runPromise(Scope.close(scope, Exit.void))
    expect(jobs.jobs.get("f:0")!.cancelled).toBe(true)
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
        { runId: "k" },
      ),
    )
    await jobs.started()
    jobs.finish("k:0", 7)
    expect(await Effect.runPromise(run.result)).toMatchObject({ ok: true, value: ["k:1", 7] })
    expect(keys.toSorted()).toEqual(["after echo k:1", "after job k:0", "before echo k:1", "before job k:0"])
  })

  test("the snapshot codec does not import Effect", async () => {
    for (const file of ["codec.ts", "snapshot.ts"]) {
      expect(await Bun.file(`${import.meta.dir}/../src/snapshot/${file}`).text()).not.toMatch(/from "effect"/)
    }
  })
})

describe("resume", () => {
  /** A run suspended while waiting on a durable call: its saved state, and the call's key. */
  const suspendAt = async (code: string, extensions: ReadonlyArray<Extension.Extension> = []) => {
    const jobs = durableJobs()
    const run = start(CodeMode.make({ extensions, tools: { job: jobs.tool } }).execute(code, undefined, { runId: "r" }))
    await jobs.started()
    await Bun.sleep(1)
    return { jobs, suspended: suspendedOf(await Effect.runPromise(run.suspend)) }
  }

  test("a run saved to a file resumes in another process", async () => {
    const jobs = durableJobs()
    const run = start(
      CodeMode.make({ tools: { slow: jobs.tool } }).execute(`
        const seen = new Map([["first", await tools.slow({ value: 10 })]])
        const second = await tools.slow({ value: 21 })
        return [seen.get("first").value, second.value]`),
    )
    await jobs.started()
    await Bun.sleep(1)
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    const file = path.join(tmpdir(), `codemode-${crypto.randomUUID()}.state`)
    await Bun.write(file, CodeMode.toBytes(suspended.state))
    try {
      const child = Bun.spawn(
        ["bun", path.join(import.meta.dir, "fixtures/resume-process.ts"), file, suspended.pending[0]!.key],
        { stdout: "pipe", stderr: "inherit" },
      )
      const output = await new Response(child.stdout).text()
      expect(await child.exited).toBe(0)
      expect(JSON.parse(output)).toEqual({ ok: true, value: [20, 42], toolCalls: [{ name: "slow" }, { name: "slow" }] })
    } finally {
      await Bun.file(file).delete()
    }
  })

  test("every pending durable call needs an outcome, and only those have one", async () => {
    const { jobs, suspended } = await suspendAt(`return (await tools.job({ value: 1 })).value`)
    const runtime = CodeMode.make({ tools: { job: jobs.tool } })
    expect((await refusal(runtime.resume(suspended.state))).message).toBe(
      "The pending durable call r:0 (tools.job) needs an outcome to resume.",
    )
    expect(
      (
        await refusal(
          runtime.resume(suspended.state, {
            "r:0": { ok: true, value: { value: 1 } },
            "r:9": { ok: true, value: { value: 2 } },
          }),
        )
      ).message,
    ).toBe("An outcome was given for r:9, which isn't a pending durable call of this run.")
  })

  test("an error outcome rejects the call's promise with a tool error the program can catch", async () => {
    const { jobs, suspended } = await suspendAt(`
      try {
        return await tools.job({ value: 1 })
      } catch (error) {
        return [error.name, error.message, error instanceof Error]
      }`)
    const outcome = await Effect.runPromise(
      start(
        CodeMode.make({ tools: { job: jobs.tool } }).resume(suspended.state, {
          "r:0": { ok: false, error: "job failed" },
        }),
      ).result,
    )
    expect(outcome).toEqual({ ok: true, value: ["Error", "job failed", true], toolCalls: [{ name: "job" }] })
  })

  test("an outcome is copied as JSON", async () => {
    const { jobs, suspended } = await suspendAt(`const r = await tools.job({ value: 1 }); r.list.push(4); return r`)
    const value = { list: [1, 2, 3] }
    const outcome = await Effect.runPromise(
      start(CodeMode.make({ tools: { job: jobs.tool } }).resume(suspended.state, { "r:0": { ok: true, value } }))
        .result,
    )
    expect(outcome).toMatchObject({ ok: true, value: { list: [1, 2, 3, 4] } })
    expect(value.list).toEqual([1, 2, 3])
  })

  test("a resumed run keeps the limits it was saved with", async () => {
    const jobs = durableJobs()
    const limited = CodeMode.make({ tools: { job: jobs.tool }, limits: { maxToolCalls: 2, maxOutputBytes: 10 } })
    const run = start(
      limited.execute(
        `await tools.job({ value: 1 }); await tools.job({ value: 2 }); await tools.job({ value: 3 }); return "done"`,
        undefined,
        { runId: "l" },
      ),
    )
    await jobs.started()
    await Bun.sleep(1)
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    expect(suspended.state.header.limits).toEqual({ timeoutMs: null, maxToolCalls: 2, maxOutputBytes: 10 })
    jobs.reset()
    // The resuming runtime has no limits of its own; the saved ones apply.
    const result = Effect.runPromise(
      start(
        CodeMode.make({ tools: { job: jobs.tool } }).resume(suspended.state, {
          "l:0": { ok: true, value: { value: 1 } },
        }),
      ).result,
    )
    await jobs.started()
    await Bun.sleep(1)
    jobs.finish("l:1", 2)
    expect(await result).toMatchObject({ ok: false, error: { kind: "ToolCallLimitExceeded" } })

    const long = start(
      CodeMode.make({ tools: { job: jobs.tool }, limits: { maxOutputBytes: 10 } }).execute(
        `await tools.job({ value: 1 }); return "x".repeat(100)`,
        undefined,
        { runId: "o" },
      ),
    )
    jobs.reset()
    await jobs.started()
    await Bun.sleep(1)
    const saved = suspendedOf(await Effect.runPromise(long.suspend))
    expect(
      await Effect.runPromise(
        start(
          CodeMode.make({ tools: { job: jobs.tool } }).resume(saved.state, {
            "o:0": { ok: true, value: { value: 1 } },
          }),
        ).result,
      ),
    ).toMatchObject({ ok: true, truncated: true })
  })

  test("active time and tool calls count across resumes", async () => {
    const jobs = durableJobs()
    const runtime = CodeMode.make({ tools: { job: jobs.tool }, limits: { timeoutMs: 300 } })
    const run = start(
      runtime.execute(
        `
        const started = Date.now()
        while (Date.now() - started < 200) {}
        await tools.job({ value: 1 })
        const again = Date.now()
        while (Date.now() - again < 200) {}
        return "done"`,
        undefined,
        { runId: "t" },
      ),
    )
    await jobs.started()
    await Bun.sleep(1)
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    expect(suspended.state.header.budget.activeMs).toBeGreaterThanOrEqual(200)
    expect(suspended.state.header.budget.toolCalls).toBe(1)
    // 200ms were used before the suspend; the next 200ms of work go past the 300ms limit.
    const timedOut = await Effect.runPromise(
      start(runtime.resume(suspended.state, { "t:0": { ok: true, value: { value: 1 } } })).result,
    )
    expect(timedOut).toMatchObject({ ok: false, error: { kind: "TimeoutExceeded" }, toolCalls: [{ name: "job" }] })
  })

  test("a state is refused by another build, other extensions, or a changed source", async () => {
    const { suspended } = await suspendAt(`await tools.job({ value: 1 }); return 1`)
    const state = suspended.state
    const header = state.header
    const runtime = CodeMode.make({ tools: {} })
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
    const { jobs, suspended } = await suspendAt(
      `
      const inc = make()
      const before = inc(1)
      await tools.job({ value: 0 })
      try {
        return { before, after: inc(1) }
      } catch (error) {
        return { before, error: String(error) }
      }`,
      [extension],
    )
    const outcome = await Effect.runPromise(
      start(
        CodeMode.make({ tools: { job: jobs.tool }, extensions: [extension] }).resume(suspended.state, {
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

  test("program state of every kind survives a suspend", async () => {
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
      await tools.job({ value: 1 })
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
    const { jobs, suspended } = await suspendAt(code)
    const outcome = await Effect.runPromise(
      start(
        CodeMode.make({ tools: { job: jobs.tool } }).resume(CodeMode.toBytes(suspended.state), {
          "r:0": { ok: true, value: { value: 1 } },
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
