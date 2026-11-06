import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect, Exit, Fiber, Schema, Scope } from "effect"
import { CodeMode, Extension, Tool } from "../../src/index.js"

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
    const run = start(CodeMode.make({ engine: "vm", tools: { job: jobs.tool }, hooks }).start(code, undefined, { runId: "run-1" }))
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
          CodeMode.make({ engine: "vm", tools: { job: jobs.tool } }).resume(state, { "run-1:0": { ok: true, value: { value: 41 } } }),
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
    const runtime = CodeMode.make({ engine: "vm",
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
      const run = start(runtime.start(code, undefined, { runId: "b" }))
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
      CodeMode.make({ engine: "vm", tools: { job: jobs.tool } }).start(`return (await tools.job({ value: 3 })).value`, undefined, {
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
      CodeMode.make({ engine: "vm", tools: { slow: slow.tool, "a-b": { job: jobs.tool } } }).start(
        `return await Promise.all([tools["a-b"].job({ value: 1 }), tools.slow({ value: 2 }), tools.slow({ value: 3 })])`,
        undefined,
        { runId: "n" },
      ),
    )
    await jobs.started()
    while (slow.calls.length < 2) await Bun.sleep(1)
    expect((await blocked(run)).running).toEqual([
      { key: "n:1", path: "tools.slow" },
      { key: "n:2", path: "tools.slow" },
    ])
  })

  test("a suspend after the run ended gives its result", async () => {
    const run = start(CodeMode.make({ engine: "vm",}).start(`return 1 + 1`))
    expect(await Effect.runPromise(run.result)).toEqual({ ok: true, value: 2, toolCalls: [] })
    expect(await Effect.runPromise(run.suspend)).toEqual({ ok: true, value: 2, toolCalls: [] })
  })

  test("a suspend before the program's first step saves its initial state", async () => {
    const runtime = CodeMode.make({ engine: "vm", tools: {} })
    const suspended = suspendedOf(
      await Effect.runPromise(
        Effect.scoped(
          Effect.flatMap(
            runtime.start(`let n = 0; for (let i = 0; i < 10; i++) n += i; return n`),
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
      CodeMode.make({ engine: "vm", tools: { job: jobs.tool }, suspend: { maxBytes: 100 } }).start(
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
    const runtime = CodeMode.make({ engine: "vm", tools: { job: jobs.tool }, hooks })
    const outcome = await Effect.runPromise(
      start(runtime.start(`tools.job({ value: 1 }); return "left"`, undefined, { runId: "e" })).result,
    )
    expect(outcome).toMatchObject({ ok: true, value: "left" })
    expect(jobs.jobs.get("e:0")!.cancelled).toBe(true)
    expect(events).toEqual(["e:0 interrupted"])

    jobs.reset()
    const scope = Scope.makeUnsafe()
    await Effect.runPromise(
      Scope.provide(scope)(runtime.start(`return (await tools.job({ value: 2 })).value`, undefined, { runId: "f" })),
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
    const runtime = CodeMode.make({ engine: "vm",
      tools: { echo, job: jobs.tool },
      hooks: {
        "tool.before": (call) => Effect.sync(() => void keys.push(`before ${call.name} ${call.key}`)),
        "tool.after": (call) => Effect.sync(() => void keys.push(`after ${call.name} ${call.key}`)),
      },
    })
    const run = start(
      runtime.start(
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
      expect(await Bun.file(`${import.meta.dir}/../../src/vm/snapshot/${file}`).text()).not.toMatch(/from "effect"/)
    }
  })
})

describe("ctx.suspend", () => {
  /**
   * A durable tool that asks for approval: it suspends the run from `start` or from `attach`, for the host to give the
   * answer on resume. A refused suspend is caught, and the call answers with who blocked it.
   */
  const approval = (from: "start" | "attach") => {
    const log: Array<string> = []
    const suspend = (ctx: Tool.DurableContext, handle: Tool.Handle) =>
      ctx.suspend.pipe(
        Effect.catch((error: CodeMode.SuspendError) =>
          Effect.sync(() => {
            log.push(`refused ${ctx.key}`)
            return { refused: error.running.map((call) => call.path), handle }
          }),
        ),
      )
    const tool = Tool.make({
      description: "Asks for approval",
      input: Schema.Struct({ question: Schema.String }),
      output: Schema.Unknown,
      durable: {
        start: (input, ctx) => {
          log.push(`start ${ctx.key}`)
          return from === "start" ? suspend(ctx, null) : Effect.succeed({ asked: input.question })
        },
        attach: (handle, ctx) => {
          log.push(`attach ${ctx.key}`)
          return from === "attach" ? suspend(ctx, handle) : Effect.succeed(handle)
        },
        cancel: () => Effect.sync(() => void log.push("cancel")),
      },
    })
    return { tool, log }
  }

  for (const from of ["start", "attach"] as const) {
    test(`a durable tool suspends its run from ${from}, and resume gives the call its value`, async () => {
      const ask = approval(from)
      const run = start(
        CodeMode.make({ engine: "vm", tools: { ask: ask.tool } }).start(
          `const answer = await tools.ask({ question: "ship it?" }); return "answer: " + answer`,
          undefined,
          { runId: "a" },
        ),
      )
      const suspended = suspendedOf(await Effect.runPromise(run.result))
      expect(suspended.pending).toEqual([
        {
          key: "a:0",
          path: "tools.ask",
          args: [{ question: "ship it?" }],
          ...(from === "attach" ? { handle: { asked: "ship it?" } } : {}),
        },
      ])
      expect(ask.log).toEqual(from === "start" ? ["start a:0"] : ["start a:0", "attach a:0"])
      const outcome = await Effect.runPromise(
        start(
          CodeMode.make({ engine: "vm", tools: { ask: ask.tool } }).resume(CodeMode.toBytes(suspended.state), {
            "a:0": { ok: true, value: "yes" },
          }),
        ).result,
      )
      expect(outcome).toEqual({ ok: true, value: "answer: yes", toolCalls: [{ name: "ask" }] })
      expect(ask.log).not.toContain("cancel")
    })
  }

  test("a call that suspends as it starts leaves the calls after it queued, and they start on resume", async () => {
    const ask = approval("start")
    const echoed: Array<number> = []
    const echo = Tool.make({
      description: "Echoes",
      input: Value,
      output: Value,
      execute: (input) => Effect.sync(() => (echoed.push(input.value), input)),
    })
    const tools = { ask: ask.tool, echo }
    const run = start(
      CodeMode.make({ engine: "vm", tools }).start(
        `const [answer, echoed] = await Promise.all([tools.ask({ question: "q" }), tools.echo({ value: 5 })])
         return [answer, echoed.value]`,
        undefined,
        { runId: "q" },
      ),
    )
    const suspended = suspendedOf(await Effect.runPromise(run.result))
    expect(suspended.pending.map((call) => call.key)).toEqual(["q:0"])
    expect(echoed).toEqual([])
    const outcome = await Effect.runPromise(
      start(CodeMode.make({ engine: "vm", tools }).resume(suspended.state, { "q:0": { ok: true, value: "yes" } })).result,
    )
    expect(outcome).toEqual({ ok: true, value: ["yes", 5], toolCalls: [{ name: "ask" }, { name: "echo" }] })
    expect(echoed).toEqual([5])
  })

  test("a durable call's suspend fails inside the tool while another call blocks it, and the run goes on", async () => {
    const ask = approval("start")
    const slow = manual()
    const fetched = latch<string>()
    const extension = Extension.make({ name: "web", globals: { fetch: async () => fetched.promise } })
    const runtime = CodeMode.make({ engine: "vm", tools: { ask: ask.tool, slow: slow.tool }, extensions: [extension] })

    const run = start(
      runtime.start(
        `const pending = tools.slow({ value: 1 })
         const answer = await tools.ask({ question: "q" })
         return [answer, (await pending).value]`,
        undefined,
        { runId: "w" },
      ),
    )
    await slow.called()
    // The program may reach the durable call only later: answer once it was refused.
    while (!ask.log.includes("refused w:1")) await Bun.sleep(1)
    slow.calls[0]!.answer(2)
    expect(await Effect.runPromise(run.result)).toMatchObject({
      ok: true,
      value: [{ refused: ["tools.slow"], handle: null }, 2],
    })

    // A queued extension call holds live host values, so it blocks too.
    const queued = start(
      runtime.start(
        `const answer = tools.ask({ question: "q" })
         const page = fetch("https://a.test/")
         return [await answer, await page]`,
        undefined,
        { runId: "x" },
      ),
    )
    fetched.resolve("page")
    expect(await Effect.runPromise(queued.result)).toMatchObject({
      ok: true,
      value: [{ refused: ["fetch"], handle: null }, "page"],
    })
  })

  test("a tool that isn't durable can't suspend its run", async () => {
    const tool = Tool.make({
      description: "Tries to suspend",
      input: Schema.Struct({}),
      output: Schema.String,
      execute: (_, ctx) =>
        (ctx as unknown as Tool.DurableContext).suspend.pipe(
          Effect.catch((error: CodeMode.SuspendError) => Effect.succeed(`${error._tag}: ${error.message}`)),
        ),
    })
    expect(
      await Effect.runPromise(
        start(CodeMode.make({ engine: "vm", tools: { tool } }).start(`return await tools.tool({})`)).result,
      ),
    ).toMatchObject({ ok: true, value: "SuspendError: Only a durable tool can suspend its run." })
  })

  test("runtime.execute fails with ExecutionFailure when a durable tool suspends, and legacy rejects start and resume", async () => {
    const ask = approval("start")
    expect(
      await Effect.runPromise(
        CodeMode.make({ engine: "vm", tools: { ask: ask.tool } }).execute(`return await tools.ask({ question: "q" })`),
      ),
    ).toEqual({
      ok: false,
      error: { kind: "ExecutionFailure", message: "The program suspended, which isn't supported here." },
      toolCalls: [{ name: "ask" }],
    })
    const legacy = CodeMode.make({ engine: "legacy" })
    expect(() => legacy.start("return 1")).toThrow('CodeMode.Runtime.start requires `engine: "vm"`.')
    expect(() => legacy.resume(new Uint8Array())).toThrow('CodeMode.Runtime.resume requires `engine: "vm"`.')
  })
})

describe("extension snapshot hooks", () => {
  type Saved = {
    readonly url: string
    readonly headers: ReadonlyArray<readonly [string, string]>
    readonly body: Uint8Array
  }
  const data = Symbol("data")

  /** A `get` global whose responses its `snapshot` hooks save as plain data, as core's `fetch` does. */
  const web = (snapshot: Partial<Extension.Snapshot> = {}) => {
    const counts = { encode: 0, decode: 0 }
    const response = (saved: Saved) => ({
      [data]: saved,
      url: saved.url,
      text: async () => new TextDecoder().decode(saved.body),
      bytes: async () => saved.body,
      headers: { get: (name: string) => saved.headers.find(([key]) => key === name)?.[1] ?? null },
    })
    const extension = Extension.make({
      name: "web",
      globals: {
        get: async (url: string) =>
          response({ url, headers: [["x-id", "7"]], body: new TextEncoder().encode(`hello ${url}`) }),
      },
      snapshot: {
        encode: (value) => (counts.encode++, (value as { [data]: Saved })[data]),
        decode: (saved) => (counts.decode++, response(saved as Saved)),
        ...snapshot,
      },
    })
    return { extension, counts }
  }

  const code = `
    const res = await get("https://a.test/")
    const text = res.text
    const header = res.headers.get
    await tools.job({ value: 1 })
    return [await text(), header("x-id"), res.headers.get("x-id"), [...(await res.bytes())].length, res.url]`

  const suspendWith = async (extension: Extension.Extension) => {
    const jobs = durableJobs()
    const run = start(
      CodeMode.make({ engine: "vm", tools: { job: jobs.tool }, extensions: [extension] }).start(code, undefined, { runId: "h" }),
    )
    await jobs.started()
    await Bun.sleep(1)
    return { jobs, run }
  }

  test("functions inside a returned value survive a suspend, saved once through the extension's hooks", async () => {
    const { extension, counts } = web()
    const { jobs, run } = await suspendWith(extension)
    // The round-trip test mode saves and restores the run all along; count this suspend's calls alone.
    const encoded = counts.encode
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    // Two functions taken from one response, one of them nested, and the response itself: one saved value.
    expect(suspended.state.records.filter((record) => record.t === "HostValue")).toHaveLength(1)
    expect(counts.encode - encoded).toBe(1)

    const resumed = web()
    const execution = start(
      CodeMode.make({ engine: "vm", tools: { job: jobs.tool }, extensions: [resumed.extension] }).resume(
        CodeMode.toBytes(suspended.state),
        { "h:1": { ok: true, value: { value: 1 } } },
      ),
    )
    // Restoring decoded the response once; the program hasn't run on yet.
    expect(resumed.counts).toEqual({ encode: 0, decode: 1 })
    const outcome = await Effect.runPromise(execution.result)
    expect(outcome).toEqual({
      ok: true,
      value: ["hello https://a.test/", "7", "7", 21, "https://a.test/"],
      toolCalls: [{ name: "job" }],
    })
  })

  test("a suspend fails, and the run goes on, when encode throws or gives anything but plain data", async () => {
    const cases: ReadonlyArray<readonly [Partial<Extension.Snapshot>, string]> = [
      [
        { encode: () => ({ when: new Date(0) }) },
        "The run's state couldn't be saved: The extension \"web\" saved a value it returned as data holding a Date; snapshot.encode must give plain data (JSON values and Uint8Arrays).",
      ],
      [
        { encode: () => ({ run: () => 1 }) },
        "The run's state couldn't be saved: The extension \"web\" saved a value it returned as data holding a function; snapshot.encode must give plain data (JSON values and Uint8Arrays).",
      ],
      [
        {
          encode: () => {
            throw new Error("no")
          },
        },
        "The run's state couldn't be saved: The extension \"web\" couldn't save a value it returned: no",
      ],
    ]
    for (const [snapshot, message] of cases) {
      const { jobs, run } = await suspendWith(web(snapshot).extension)
      const error = await blocked(run)
      expect(error.message).toBe(message)
      expect(error.running).toEqual([])
      jobs.finish("h:1", 1)
      expect(await Effect.runPromise(run.result)).toMatchObject({
        ok: true,
        value: ["hello https://a.test/", "7", "7", 21, "https://a.test/"],
      })
    }
  })

  test("a state that holds a hooked value is refused without that extension or without its hooks", async () => {
    const { extension } = web()
    const { jobs, run } = await suspendWith(extension)
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    const outcomes = { "h:1": { ok: true, value: { value: 1 } } } as const
    const unhooked = Extension.make({ name: "web", globals: extension.globals })
    const other = Extension.make({ name: "other", globals: extension.globals, snapshot: extension.snapshot })
    for (const extensions of [[], [unhooked], [other]]) {
      expect(
        (await refusal(CodeMode.make({ engine: "vm", tools: { job: jobs.tool }, extensions }).resume(suspended.state, outcomes)))
          .message,
      ).toBe("This state was saved by a runtime with other host globals (extensions); resume it with the same ones.")
    }
  })
})

describe("resume", () => {
  /** A run suspended while waiting on a durable call: its saved state, and the call's key. */
  const suspendAt = async (code: string, extensions: ReadonlyArray<Extension.Extension> = []) => {
    const jobs = durableJobs()
    const run = start(CodeMode.make({ engine: "vm", extensions, tools: { job: jobs.tool } }).start(code, undefined, { runId: "r" }))
    await jobs.started()
    await Bun.sleep(1)
    return { jobs, suspended: suspendedOf(await Effect.runPromise(run.suspend)) }
  }

  test("a run saved to a file resumes in another process", async () => {
    const jobs = durableJobs()
    const run = start(
      CodeMode.make({ engine: "vm", tools: { slow: jobs.tool } }).start(`
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
        ["bun", path.join(import.meta.dir, "../fixtures/resume-process.ts"), file, suspended.pending[0]!.key],
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
    const runtime = CodeMode.make({ engine: "vm", tools: { job: jobs.tool } })
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
        CodeMode.make({ engine: "vm", tools: { job: jobs.tool } }).resume(suspended.state, {
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
      start(CodeMode.make({ engine: "vm", tools: { job: jobs.tool } }).resume(suspended.state, { "r:0": { ok: true, value } }))
        .result,
    )
    expect(outcome).toMatchObject({ ok: true, value: { list: [1, 2, 3, 4] } })
    expect(value.list).toEqual([1, 2, 3])
  })

  test("a resumed run keeps the limits it was saved with", async () => {
    const jobs = durableJobs()
    const limited = CodeMode.make({ engine: "vm", tools: { job: jobs.tool }, limits: { maxToolCalls: 2, maxOutputBytes: 10 } })
    const run = start(
      limited.start(
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
        CodeMode.make({ engine: "vm", tools: { job: jobs.tool } }).resume(suspended.state, {
          "l:0": { ok: true, value: { value: 1 } },
        }),
      ).result,
    )
    await jobs.started()
    await Bun.sleep(1)
    jobs.finish("l:1", 2)
    expect(await result).toMatchObject({ ok: false, error: { kind: "ToolCallLimitExceeded" } })

    const long = start(
      CodeMode.make({ engine: "vm", tools: { job: jobs.tool }, limits: { maxOutputBytes: 10 } }).start(
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
          CodeMode.make({ engine: "vm", tools: { job: jobs.tool } }).resume(saved.state, {
            "o:0": { ok: true, value: { value: 1 } },
          }),
        ).result,
      ),
    ).toMatchObject({ ok: true, truncated: true })
  })

  test("active time and tool calls count across resumes", async () => {
    const jobs = durableJobs()
    const runtime = CodeMode.make({ engine: "vm", tools: { job: jobs.tool }, limits: { timeoutMs: 300 } })
    const run = start(
      runtime.start(
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
    const runtime = CodeMode.make({ engine: "vm", tools: {} })
    expect((await refusal(runtime.resume({ ...state, header: { ...header, build: "0.0.0+0" } }))).message).toMatch(
      /saved by another Code Mode build \(0\.0\.0\+0\)/,
    )
    const other = CodeMode.make({ engine: "vm", extensions: [Extension.make({ name: "x", globals: { f: () => 1 } })] })
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
        CodeMode.make({ engine: "vm", tools: { job: jobs.tool }, extensions: [extension] }).resume(suspended.state, {
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
        CodeMode.make({ engine: "vm", tools: { job: jobs.tool } }).resume(CodeMode.toBytes(suspended.state), {
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

  test("changes to built-ins survive a second suspend, including freeze, seal, and deletes", async () => {
    const code = `
      Array.prototype.extra = "patched"
      delete Math.max
      Object.freeze(JSON)
      Object.seal(Number.prototype)
      Object.preventExtensions(Date.prototype)
      await tools.job({ value: 1 })
      await tools.job({ value: 2 })
      return {
        extra: [].extra,
        max: typeof Math.max,
        frozen: Object.isFrozen(JSON),
        sealed: Object.isSealed(Number.prototype) && !Object.isFrozen(Number.prototype),
        extensible: Object.isExtensible(Date.prototype),
        untouched: Object.isExtensible(Map.prototype) && typeof Math.min,
      }`
    const { jobs, suspended } = await suspendAt(code)
    jobs.reset()
    const runtime = CodeMode.make({ engine: "vm", tools: { job: jobs.tool } })
    const again = start(runtime.resume(CodeMode.toBytes(suspended.state), { "r:0": { ok: true, value: { value: 1 } } }))
    await jobs.started()
    await Bun.sleep(1)
    // Nothing changed a built-in since the first resume: the second state keeps what changed before.
    const second = suspendedOf(await Effect.runPromise(again.suspend))
    const outcome = await Effect.runPromise(
      start(runtime.resume(CodeMode.toBytes(second.state), { "r:1": { ok: true, value: { value: 2 } } })).result,
    )
    expect(outcome).toMatchObject({
      ok: true,
      value: {
        extra: "patched",
        max: "undefined",
        frozen: true,
        sealed: true,
        extensible: false,
        untouched: "function",
      },
    })
  })
})
