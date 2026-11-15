import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import path from "node:path"
import { Context, Effect, Fiber, Schema } from "effect"
import { CodeMode, Extension, Tool } from "../src/index.js"

// Suspending a run, saving its state, and resuming it in a brand-new runtime.

const Value = Schema.Struct({ value: Schema.Number })

/** Runs a program in a fiber of its own: its outcome, and a way to suspend it. */
const background = <E>(program: CodeMode.Program<never, E>) => {
  const fiber = Effect.runFork(program.run())
  return { program, result: Fiber.join(fiber), suspend: program.suspend() }
}

/** Why resuming a state fails. */
const refusal = (resumed: CodeMode.Program<never, CodeMode.SnapshotError>) =>
  Effect.runPromise(Effect.flip(resumed.run()))

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
      Effect.callback<{ value: number }>((resume) => {
        calls.push({ input: input.value, answer: (value) => resume(Effect.succeed({ value })) })
        called.resolve()
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

/** A tool that doubles its input immediately and signals when called. */
const stepTool = () => {
  let called = latch()
  const tool = Tool.make({
    description: "Doubles",
    input: Value,
    output: Value,
    execute: (input) =>
      Effect.sync(() => {
        called.resolve()
        return { value: input.value * 2 }
      }),
  })
  return {
    tool,
    called: () => called.promise,
    reset: () => {
      called = latch()
    },
  }
}

/** An idempotent tool that announces each attempt and waits for the test to answer it. */
const idempotentManual = () => {
  const attempts: Array<{
    input: number
    key: string
    interrupted: boolean
    answer: (value: number) => void
  }> = []
  let called = latch()
  const tool = Tool.make({
    description: "Safe to rerun",
    input: Value,
    output: Value,
    execute: Tool.idempotent((input, { key }) =>
      Effect.callback<{ value: number }>((resume) => {
        const entry = {
          input: input.value,
          key,
          interrupted: false,
          answer: (value: number) => resume(Effect.succeed({ value })),
        }
        attempts.push(entry)
        called.resolve()
        return Effect.sync(() => {
          entry.interrupted = true
        })
      }),
    ),
  })
  return {
    tool,
    attempts,
    called: () => called.promise,
    reset: () => {
      called = latch()
    },
  }
}

/** A durable tool over an in-memory job table that outlives any one run, as a subagent or job supervisor would. */
const durableJobs = (options: { startGate?: Promise<void> } = {}) => {
  const jobs = new Map<
    string,
    { input: number; result: ReturnType<typeof latch<number>>; cancelled: number; savedData: Array<unknown> }
  >()
  const log: Array<string> = []
  let started = latch()
  let waiting = latch()
  const tool = Tool.make({
    description: "Runs a durable job",
    input: Value,
    output: Value,
    execute: Tool.durable({
      start: (input, { key }) =>
        Effect.gen(function* () {
          log.push(`start ${key}`)
          jobs.set(key, { input: input.value, result: latch<number>(), cancelled: 0, savedData: [] })
          started.resolve()
          if (options.startGate !== undefined) yield* Effect.promise(() => options.startGate!)
          return { job: key, meta: { input: input.value, tags: ["a", "b"] } }
        }),
      wait: (data, { key }) =>
        Effect.promise(() => {
          log.push(`wait ${key} ${data.job}`)
          const job = jobs.get(data.job)!
          job.savedData.push(data)
          waiting.resolve()
          return job.result.promise.then((value) => ({ value }))
        }),
      cancel: ({ job }) =>
        Effect.sync(() => {
          log.push(`cancel ${job}`)
          jobs.get(job)!.cancelled += 1
        }),
    }),
  })
  return {
    tool,
    jobs,
    log,
    started: () => started.promise,
    waiting: () => waiting.promise,
    finish: (key: string, value: number) => jobs.get(key)!.result.resolve(value),
    reset: () => {
      started = latch()
      waiting = latch()
    },
  }
}

const suspendedOf = (outcome: CodeMode.Result | CodeMode.Suspended): CodeMode.Suspended => {
  if (outcome.ok !== "suspended") throw new Error(`expected a suspended run, got ${JSON.stringify(outcome)}`)
  return outcome
}

/** Runs `code` until `step` has completed and the VM is yielding at a slice boundary with no host call running. */
const suspendBetweenCalls = async (
  code: string,
  options: {
    readonly extensions?: ReadonlyArray<Extension.Extension>
    readonly limits?: CodeMode.ExecutionLimits
  } = {},
) => {
  const step = stepTool()
  const runtime = CodeMode.make({
    tools: { step: step.tool },
    ...(options.extensions ? { extensions: options.extensions } : {}),
    ...(options.limits ? { limits: options.limits } : {}),
  })
  const run = background(runtime.program(code))
  await step.called()
  await Bun.sleep(10)
  return { step, runtime, run }
}

describe("synchronous host calls", () => {
  // Each sync extension call stops the VM; the slice clock must keep running across those stops, or a loop of them
  // never yields: suspend can't land and timeouts can't interrupt it.
  const counter = () => {
    let calls = 0
    let reached = latch()
    const extension = Extension.make({
      name: "draw",
      globals: {
        draw: (n: number) => {
          calls += 1
          if (calls === 500) reached.resolve()
          return n
        },
      },
    })
    return { extension, reached: () => reached.promise, calls: () => calls }
  }

  // Round-trip mode also yields at every host stop, where a suspend lands mid-call and is rightly refused.
  test.skipIf(process.env.CODEMODE_ROUNDTRIP === "1")(
    "a loop of sync extension calls can be suspended and resumed",
    async () => {
      const draw = counter()
      const runtime = CodeMode.make({ extensions: [draw.extension] })
      const run = background(runtime.program("let n = 0\nwhile (n < 200000) draw(n++)\nreturn n"))
      await draw.reached()
      const suspended = suspendedOf(await Effect.runPromise(run.suspend))
      expect(draw.calls()).toBeLessThan(200000)
      const resumed = await Effect.runPromise(background(runtime.resume(CodeMode.toBytes(suspended.state))).result)
      expect(resumed).toMatchObject({ ok: true, value: 200000 })
    },
  )

  test("a loop of sync extension calls is interrupted by the timeout", async () => {
    const draw = counter()
    const outcome = await Effect.runPromise(
      CodeMode.make({ extensions: [draw.extension], limits: { timeoutMs: 100 } }).execute(
        "let n = 0\nwhile (true) draw(n++)",
      ),
    )
    expect(outcome).toMatchObject({ ok: false, error: { kind: "TimeoutExceeded" } })
  })
})

describe("suspend", () => {
  test("a run suspended while idle-awaiting between calls resumes from state and from bytes", async () => {
    const code = `
      const log = ["before"]
      const a = await tools.step({ value: 20 })
      const started = Date.now()
      while (Date.now() - started < 300) await Promise.resolve()
      const b = await tools.step({ value: 1 })
      log.push("after " + (a.value + b.value))
      console.log("resumed")
      return { log, total: a.value + b.value }`
    const { step, run } = await suspendBetweenCalls(code)
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    // The run's own result is the same saved state.
    expect(suspendedOf(await Effect.runPromise(run.result))).toBe(suspended)

    for (const state of [suspended.state, CodeMode.toBytes(suspended.state)] as const) {
      const outcome = await Effect.runPromise(
        background(CodeMode.make({ tools: { step: step.tool } }).resume(state)).result,
      )
      expect(outcome).toEqual({
        ok: true,
        value: { log: ["before", "after 42"], total: 42 },
        logs: ["resumed"],
        toolCalls: [{ name: "step" }, { name: "step" }],
      })
    }
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
      const run = background(runtime.program(code, undefined, { runId: "b" }))
      await running()
      const error = await blocked(run)
      expect(error, name).toBeInstanceOf(CodeMode.SuspendError)
      expect(error.running, name).toEqual([{ key: "b:0", path }])
      expect(error.message, name).toBe(`The run can't be suspended while ${path} is running.`)
      release()
      expect(await Effect.runPromise(run.result), name).toMatchObject({ ok: true, value })
    }
  })

  test("every running call that blocks a suspend is named", async () => {
    const slow = manual()
    const run = background(
      CodeMode.make({ tools: { slow: slow.tool, "a-b": { work: slow.tool } } }).program(
        `return await Promise.all([tools["a-b"].work({ value: 1 }), tools.slow({ value: 2 })])`,
        undefined,
        { runId: "n" },
      ),
    )
    while (slow.calls.length < 2) await Bun.sleep(1)
    expect((await blocked(run)).running).toEqual([
      { key: "n:0", path: 'tools["a-b"].work' },
      { key: "n:1", path: "tools.slow" },
    ])
  })

  test("a suspend after the run ended gives its result", async () => {
    const program = CodeMode.make().program(`return 1 + 1`)
    expect(await Effect.runPromise(program.run())).toEqual({ ok: true, value: 2, toolCalls: [] })
    expect(await Effect.runPromise(program.suspend())).toEqual({ ok: true, value: 2, toolCalls: [] })
  })

  test("a program runs inline in the current fiber", async () => {
    const runtime = CodeMode.make({ tools: { step: stepTool().tool } })
    expect(
      await Effect.runPromise(runtime.program(`return (await tools.step({ value: x })).value`, { x: 21 }).run()),
    ).toEqual({ ok: true, value: 42, toolCalls: [{ name: "step" }] })
  })

  test("a suspend from another fiber stops a background run, which returns the same state", async () => {
    const runtime = CodeMode.make({ tools: {} })
    const code = `let n = 0; for (let i = 0; i < 2_000_000; i++) n = (n + i) % 1_000_003; return n`
    const expected = await Effect.runPromise(runtime.execute(code))
    const [suspended, outcome] = await Effect.runPromise(
      Effect.gen(function* () {
        const program = runtime.program(code)
        const fiber = yield* Effect.forkChild(program.run())
        // Issued before the run starts: it waits for it.
        const suspended = yield* program.suspend()
        return [suspended, yield* Fiber.join(fiber)] as const
      }),
    )
    expect(outcome).toBe(suspended)
    const fresh = CodeMode.make({ tools: {} })
    expect(await Effect.runPromise(fresh.resume(CodeMode.toBytes(suspendedOf(suspended).state)).run())).toEqual(
      expected,
    )
  })

  test("a program runs once", async () => {
    const program = CodeMode.make().program(`return 1`)
    expect(await Effect.runPromise(program.run())).toMatchObject({ ok: true, value: 1 })
    const exit = await Effect.runPromise(Effect.exit(program.run()))
    expect(String(exit)).toContain("A CodeMode program runs once")
  })

  test("interrupting run interrupts the program and its running calls", async () => {
    const called = latch()
    const interrupted = latch()
    const hang = Tool.make({
      description: "Never answers",
      input: Value,
      output: Value,
      execute: () =>
        Effect.sync(() => called.resolve()).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Effect.sync(() => interrupted.resolve())),
        ),
    })
    const program = CodeMode.make({ tools: { hang } }).program(`return await tools.hang({ value: 1 })`)
    const fiber = Effect.runFork(program.run())
    await called.promise
    await Effect.runPromise(Fiber.interrupt(fiber))
    await interrupted.promise
  })

  test("a state over the byte budget fails the suspend, and the run goes on", async () => {
    const { run } = await suspendBetweenCalls(
      `const big = "x".repeat(1000); await tools.step({ value: 1 }); const t = Date.now(); while (Date.now() - t < 300) {} return big.length`,
    )
    const error = await blocked({ suspend: run.program.suspend({ maxBytes: 100 }) })
    expect(error.running).toEqual([])
    expect(error.message).toMatch(/^The run's state takes \d+ bytes, more than the 100-byte limit/)
    expect(await Effect.runPromise(run.result)).toMatchObject({ ok: true, value: 1000 })
  })

  test("a maxBytes that isn't a non-negative integer is rejected", () => {
    const program = CodeMode.make().program("return 1")
    expect(() => program.suspend({ maxBytes: -1 })).toThrow(RangeError)
  })

  test("the snapshot codec does not import Effect", async () => {
    for (const file of ["codec.ts", "snapshot.ts"]) {
      expect(await Bun.file(path.join(import.meta.dir, "../src/snapshot", file)).text()).not.toMatch(
        /from "effect"/,
      )
    }
  })
})

describe("resume", () => {
  const suspendAt = async (code: string, extensions: ReadonlyArray<Extension.Extension> = []) => {
    const { step, run } = await suspendBetweenCalls(code, { extensions })
    return { step, suspended: suspendedOf(await Effect.runPromise(run.suspend)) }
  }

  test("a run saved to a file resumes in another process", async () => {
    const step = stepTool()
    const run = background(
      CodeMode.make({ tools: { slow: step.tool } }).program(`
        const seen = new Map([["first", await tools.slow({ value: 10 })]])
        const started = Date.now()
        while (Date.now() - started < 300) {}
        const second = await tools.slow({ value: 21 })
        return [seen.get("first").value, second.value]`),
    )
    await step.called()
    await Bun.sleep(10)
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    const file = path.join(tmpdir(), `codemode-${crypto.randomUUID()}.state`)
    await Bun.write(file, CodeMode.toBytes(suspended.state))
    try {
      const child = Bun.spawn(["bun", path.join(import.meta.dir, "fixtures/resume-process.ts"), file], {
        stdout: "pipe",
        stderr: "inherit",
      })
      const output = await new Response(child.stdout).text()
      expect(await child.exited).toBe(0)
      expect(JSON.parse(output)).toEqual({ ok: true, value: [20, 42], toolCalls: [{ name: "slow" }, { name: "slow" }] })
    } finally {
      await Bun.file(file).delete()
    }
  })

  test("a resumed run keeps the limits it was saved with", async () => {
    const { step, run } = await suspendBetweenCalls(
      `await tools.step({ value: 1 }); const t = Date.now(); while (Date.now() - t < 300) {} await tools.step({ value: 2 }); await tools.step({ value: 3 }); return "done"`,
      { limits: { maxToolCalls: 2, maxOutputBytes: 10 } },
    )
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    expect(suspended.state.header.limits).toEqual({ timeoutMs: null, maxToolCalls: 2, maxOutputBytes: 10 })
    // The resuming runtime has no limits of its own; the saved ones apply.
    const result = await Effect.runPromise(
      background(CodeMode.make({ tools: { step: step.tool } }).resume(suspended.state)).result,
    )
    expect(result).toMatchObject({ ok: false, error: { kind: "ToolCallLimitExceeded" } })

    const { step: step2, run: long } = await suspendBetweenCalls(
      `await tools.step({ value: 1 }); const t = Date.now(); while (Date.now() - t < 300) {} return "x".repeat(100)`,
      { limits: { maxOutputBytes: 10 } },
    )
    const saved = suspendedOf(await Effect.runPromise(long.suspend))
    expect(
      await Effect.runPromise(
        background(CodeMode.make({ tools: { step: step2.tool } }).resume(saved.state)).result,
      ),
    ).toMatchObject({ ok: true, truncated: true })
  })

  test("active time and tool calls count across resumes", async () => {
    const step = stepTool()
    const runtime = CodeMode.make({ tools: { step: step.tool }, limits: { timeoutMs: 300 } })
    const run = background(
      runtime.program(`
        await tools.step({ value: 1 })
        const started = Date.now()
        while (Date.now() - started < 220) {}
        const again = Date.now()
        while (Date.now() - again < 200) {}
        return "done"`),
    )
    await step.called()
    await Bun.sleep(210)
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    expect(suspended.state.header.budget.activeMs).toBeGreaterThanOrEqual(200)
    expect(suspended.state.header.budget.toolCalls).toBe(1)
    // 200ms were used before the suspend; the next 200ms of work go past the 300ms limit.
    const timedOut = await Effect.runPromise(background(runtime.resume(suspended.state)).result)
    expect(timedOut).toMatchObject({ ok: false, error: { kind: "TimeoutExceeded" }, toolCalls: [{ name: "step" }] })
  })

  test("a state is refused by another build, other extensions, or a changed source", async () => {
    const { suspended } = await suspendAt(
      `await tools.step({ value: 1 }); const t = Date.now(); while (Date.now() - t < 300) {} return 1`,
    )
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
    const { step, suspended } = await suspendAt(
      `
      const inc = make()
      const before = inc(1)
      await tools.step({ value: 0 })
      const t = Date.now()
      while (Date.now() - t < 300) {}
      try {
        return { before, after: inc(1) }
      } catch (error) {
        return { before, error: String(error) }
      }`,
      [extension],
    )
    const outcome = await Effect.runPromise(
      background(
        CodeMode.make({ tools: { step: step.tool }, extensions: [extension] }).resume(suspended.state),
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
      await tools.step({ value: 1 })
      const t = Date.now()
      while (Date.now() - t < 300) {}
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
        sparse: [5001, "far", false],
        pending: await pending,
        extra: [].extra,
        negative: Object.is(-0, -0 * 1),
      }`
    const { step, suspended } = await suspendAt(code)
    const outcome = await Effect.runPromise(
      background(CodeMode.make({ tools: { step: step.tool } }).resume(CodeMode.toBytes(suspended.state)))
        .result,
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
      await tools.step({ value: 1 })
      const t1 = Date.now()
      while (Date.now() - t1 < 300) {}
      await tools.step({ value: 2 })
      const t2 = Date.now()
      while (Date.now() - t2 < 300) {}
      return {
        extra: [].extra,
        max: typeof Math.max,
        frozen: Object.isFrozen(JSON),
        sealed: Object.isSealed(Number.prototype) && !Object.isFrozen(Number.prototype),
        extensible: Object.isExtensible(Date.prototype),
        untouched: Object.isExtensible(Map.prototype) && typeof Math.min,
      }`
    const { step, suspended } = await suspendAt(code)
    step.reset()
    const runtime = CodeMode.make({ tools: { step: step.tool } })
    const again = background(runtime.resume(CodeMode.toBytes(suspended.state)))
    await step.called()
    await Bun.sleep(10)
    // Nothing changed a built-in since the first resume: the second state keeps what changed before.
    const second = suspendedOf(await Effect.runPromise(again.suspend))
    const outcome = await Effect.runPromise(background(runtime.resume(CodeMode.toBytes(second.state))).result)
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

describe("idempotent and durable tools", () => {
  test("an idempotent tool in flight can be suspended, is interrupted without firing after, and reruns on resume with the same key", async () => {
    const read = idempotentManual()
    const events: Array<string> = []
    const hooks: CodeMode.Hooks = {
      "tool.before": (call) => Effect.sync(() => void events.push(`before ${call.name} ${call.key}`)),
      "tool.after": (call, result) =>
        Effect.sync(() => void events.push(`after ${call.name} ${call.key} ${result.status}`)),
    }
    const code = `
      const a = await tools.read({ value: 20 })
      const b = await tools.read({ value: 22 })
      return a.value + b.value`
    const run = background(
      CodeMode.make({ tools: { read: read.tool }, hooks }).program(code, undefined, { runId: "rr" }),
    )
    await read.called()
    expect(read.attempts).toHaveLength(1)
    expect(read.attempts[0]!.key).toBe("rr:0")

    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    expect(suspendedOf(await Effect.runPromise(run.result))).toBe(suspended)
    expect(read.attempts[0]!.interrupted).toBe(true)
    // Detaching to suspend does not fire tool.after with interrupted.
    expect(events).toEqual(["before read rr:0"])

    read.reset()
    const resumed = background(
      CodeMode.make({ tools: { read: read.tool }, hooks }).resume(CodeMode.toBytes(suspended.state)),
    )
    await read.called()
    expect(read.attempts).toHaveLength(2)
    expect(read.attempts[1]!.key).toBe("rr:0")

    read.reset()
    read.attempts[1]!.answer(20)
    await read.called()
    expect(read.attempts[2]!.key).toBe("rr:1")
    read.attempts[2]!.answer(22)

    const outcome = await Effect.runPromise(resumed.result)
    expect(outcome).toEqual({
      ok: true,
      value: 42,
      toolCalls: [{ name: "read" }, { name: "read" }],
    })
    expect(events).toEqual([
      "before read rr:0",
      "before read rr:0",
      "after read rr:0 success",
      "before read rr:1",
      "after read rr:1 success",
    ])
  })

  test("maxToolCalls is not double-counted when an idempotent call runs again on resume", async () => {
    const read = idempotentManual()
    const runtime = () =>
      CodeMode.make({
        tools: { read: read.tool },
        limits: { maxToolCalls: 1 },
      })
    const run = background(
      runtime().program(`return (await tools.read({ value: 7 })).value`, undefined, { runId: "lim" }),
    )
    await read.called()
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    expect(suspended.state.header.budget.toolCalls).toBe(1)

    read.reset()
    const resumed = background(runtime().resume(CodeMode.toBytes(suspended.state)))
    await read.called()
    read.attempts[1]!.answer(7)
    expect(await Effect.runPromise(resumed.result)).toEqual({
      ok: true,
      value: 7,
      toolCalls: [{ name: "read" }],
    })

    // A second call after the idempotent call completes still trips the limit of 1.
    read.reset()
    const twoCalls = background(
      runtime().program(
        `const first = await tools.read({ value: 1 }); const second = await tools.read({ value: 2 }); return first.value + second.value`,
        undefined,
        { runId: "lim2" },
      ),
    )
    await read.called()
    const suspendedTwo = suspendedOf(await Effect.runPromise(twoCalls.suspend))
    read.reset()
    const resumedTwo = background(runtime().resume(CodeMode.toBytes(suspendedTwo.state)))
    await read.called()
    read.attempts[read.attempts.length - 1]!.answer(1)
    expect(await Effect.runPromise(resumedTwo.result)).toMatchObject({
      ok: false,
      error: { kind: "ToolCallLimitExceeded" },
      toolCalls: [{ name: "read" }],
    })
  })

  test("a durable tool refuses suspend during start, allows it once started, and calls wait(data) on resume", async () => {
    const gate = latch()
    const jobs = durableJobs({ startGate: gate.promise })
    const events: Array<string> = []
    const hooks: CodeMode.Hooks = {
      "tool.before": (call) => Effect.sync(() => void events.push(`before ${call.key}`)),
      "tool.after": (call, result) => Effect.sync(() => void events.push(`after ${call.key} ${result.status}`)),
    }
    const code = `
      const log = ["before"]
      const a = await tools.job({ value: 41 })
      log.push("after " + a.value)
      return { log, total: a.value + 1 }`
    const run = background(
      CodeMode.make({ tools: { job: jobs.tool }, hooks }).program(code, undefined, { runId: "rec" }),
    )
    await jobs.started()
    const duringStart = await blocked(run)
    expect(duringStart.running).toEqual([{ key: "rec:0", path: "tools.job" }])

    gate.resolve()
    await jobs.waiting()
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    expect(suspendedOf(await Effect.runPromise(run.result))).toBe(suspended)
    expect(jobs.jobs.get("rec:0")!.cancelled).toBe(0)
    expect(events).toEqual(["before rec:0"])

    jobs.reset()
    const bytes = CodeMode.toBytes(suspended.state)
    const resumed = background(CodeMode.make({ tools: { job: jobs.tool }, hooks }).resume(bytes))
    await jobs.waiting()
    // The data survived serialization to bytes and was passed to wait(data) without running start again.
    expect(jobs.log).toEqual(["start rec:0", "wait rec:0 rec:0", "wait rec:0 rec:0"])
    expect(jobs.jobs.get("rec:0")!.savedData).toEqual([
      { job: "rec:0", meta: { input: 41, tags: ["a", "b"] } },
      { job: "rec:0", meta: { input: 41, tags: ["a", "b"] } },
    ])
    jobs.finish("rec:0", 41)
    expect(await Effect.runPromise(resumed.result)).toEqual({
      ok: true,
      value: { log: ["before", "after 41"], total: 42 },
      toolCalls: [{ name: "job" }],
    })
    expect(events).toEqual(["before rec:0", "after rec:0 success"])
  })

  test("wait runs right after start and right at resume regardless of how the program uses the promise", async () => {
    const jobs = durableJobs()
    const read = idempotentManual()
    const tools = { job: jobs.tool, read: read.tool }
    // One durable call is in Promise.all with another call, one is chained with .then, and one is stored
    // unawaited in a variable and only awaited after the others settle on resume.
    const code = `
      const stored = tools.job({ value: 1 })
      const chained = tools.job({ value: 2 }).then((res) => res.value * 10)
      const [allJob, allRead] = await Promise.all([tools.job({ value: 3 }), tools.read({ value: 4 })])
      const chainedValue = await chained
      const storedValue = (await stored).value
      return [storedValue, chainedValue, allJob.value, allRead.value]`
    const run = background(CodeMode.make({ tools }).program(code, undefined, { runId: "p" }))
    await read.called()
    // All three durable calls ran start and wait before the suspend, even though `stored` has not been awaited.
    expect(jobs.log).toEqual(["start p:0", "wait p:0 p:0", "start p:1", "wait p:1 p:1", "start p:2", "wait p:2 p:2"])

    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    read.reset()
    jobs.reset()
    const resumed = background(CodeMode.make({ tools }).resume(CodeMode.toBytes(suspended.state)))
    await read.called()
    // Right at resume, the VM calls wait(data) on all three `started` calls before any of them settles.
    expect(jobs.log.slice(6)).toEqual(["wait p:0 p:0", "wait p:1 p:1", "wait p:2 p:2"])

    // Even if the unawaited `stored` job finishes first on resume, its result waits on the promise until awaited later.
    jobs.finish("p:0", 10)
    jobs.finish("p:1", 2)
    jobs.finish("p:2", 30)
    read.attempts[1]!.answer(40)
    expect(await Effect.runPromise(resumed.result)).toEqual({
      ok: true,
      value: [10, 20, 30, 40],
      toolCalls: [{ name: "job" }, { name: "job" }, { name: "job" }, { name: "read" }],
    })
  })

  test("a durable tool calls cancel(data) on a real interrupt, not on suspend", async () => {
    const jobs = durableJobs()
    const events: Array<string> = []
    const hooks: CodeMode.Hooks = {
      "tool.after": (call, result) => Effect.sync(() => void events.push(`${call.key} ${result.status}`)),
    }
    const runtime = CodeMode.make({ tools: { job: jobs.tool }, hooks })

    // 1. Background work left running when the program returns is interrupted and cancelled once.
    const leftRunning = background(
      runtime.program(`tools.job({ value: 1 }); return "left"`, undefined, { runId: "c1" }),
    )
    expect(await Effect.runPromise(leftRunning.result)).toMatchObject({ ok: true, value: "left" })
    expect(jobs.jobs.get("c1:0")!.cancelled).toBe(1)
    expect(events).toEqual(["c1:0 interrupted"])

    // 2. Interrupting the running fiber cancels the started job once.
    jobs.reset()
    const program = runtime.program(`return (await tools.job({ value: 2 })).value`, undefined, { runId: "c2" })
    const fiber = Effect.runFork(program.run())
    await jobs.waiting()
    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(jobs.jobs.get("c2:0")!.cancelled).toBe(1)
    expect(events).toEqual(["c1:0 interrupted", "c2:0 interrupted"])

    // 3. Suspending does not cancel, and interrupting after resume cancels.
    jobs.reset()
    const run = background(runtime.program(`return (await tools.job({ value: 3 })).value`, undefined, { runId: "c3" }))
    await jobs.waiting()
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    expect(jobs.jobs.get("c3:0")!.cancelled).toBe(0)

    jobs.reset()
    const resumedProgram = runtime.resume(CodeMode.toBytes(suspended.state))
    const resumedFiber = Effect.runFork(resumedProgram.run())
    await jobs.waiting()
    await Effect.runPromise(Fiber.interrupt(resumedFiber))
    expect(jobs.jobs.get("c3:0")!.cancelled).toBe(1)
  })

  test("a Promise.all combining plain, idempotent, and durable tools suspends once safe and finishes on resume", async () => {
    const slow = manual()
    const read = idempotentManual()
    const jobs = durableJobs()
    const tools = { slow: slow.tool, read: read.tool, job: jobs.tool }
    const code = `
      const [a, b, c] = await Promise.all([
        tools.slow({ value: 10 }),
        tools.read({ value: 20 }),
        tools.job({ value: 30 }),
      ])
      return [a.value, b.value, c.value]`
    const run = background(CodeMode.make({ tools }).program(code, undefined, { runId: "mix" }))
    await Promise.all([slow.called(), read.called(), jobs.waiting()])

    // While `slow` (plain) is still running, suspend is refused and lists only `tools.slow`.
    const error = await blocked(run)
    expect(error.running).toEqual([{ key: "mix:0", path: "tools.slow" }])

    // Once `slow` finishes, only `read` (idempotent) and `job` (durable in started) remain in flight.
    slow.calls[0]!.answer(10)
    await Promise.resolve()
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    expect(read.attempts[0]!.interrupted).toBe(true)
    expect(jobs.jobs.get("mix:2")!.cancelled).toBe(0)

    read.reset()
    jobs.reset()
    const resumed = background(CodeMode.make({ tools }).resume(CodeMode.toBytes(suspended.state)))
    await Promise.all([read.called(), jobs.waiting()])
    // `slow` was not called again; `read` reran with key `mix:1`; `job` waited on data `mix:2`.
    expect(slow.calls).toHaveLength(1)
    expect(read.attempts.map((a) => a.key)).toEqual(["mix:1", "mix:1"])
    expect(jobs.log).toEqual(["start mix:2", "wait mix:2 mix:2", "wait mix:2 mix:2"])

    read.attempts[1]!.answer(20)
    jobs.finish("mix:2", 30)
    expect(await Effect.runPromise(resumed.result)).toEqual({
      ok: true,
      value: [10, 20, 30],
      toolCalls: [{ name: "slow" }, { name: "read" }, { name: "job" }],
    })
  })

  test("call keys use runId (or a generated UUID), are unique per call, and stay stable across suspend and resume", async () => {
    const read = idempotentManual()
    const seenKeys: Array<string> = []
    const echo = Tool.make({
      description: "Echoes key",
      input: Value,
      output: Schema.String,
      execute: (_, { key }) => Effect.succeed(key),
    })
    const runtime = CodeMode.make({
      tools: { read: read.tool, echo },
      hooks: {
        "tool.before": (call) => Effect.sync(() => void seenKeys.push(`hook:${call.name}:${call.key}`)),
      },
    })
    const code = `
      const k0 = await tools.echo({ value: 1 })
      const v1 = await tools.read({ value: 2 })
      const k2 = await tools.echo({ value: v1.value })
      return [k0, v1.value, k2]`
    const run = background(runtime.program(code, undefined, { runId: "custom-run" }))
    await read.called()
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    expect(suspended.state.header.runId).toBe("custom-run")

    read.reset()
    const resumed = background(runtime.resume(CodeMode.toBytes(suspended.state)))
    await read.called()
    read.attempts[1]!.answer(42)
    expect(await Effect.runPromise(resumed.result)).toEqual({
      ok: true,
      value: ["custom-run:0", 42, "custom-run:2"],
      toolCalls: [{ name: "echo" }, { name: "read" }, { name: "echo" }],
    })
    expect(seenKeys).toEqual([
      "hook:echo:custom-run:0",
      "hook:read:custom-run:1",
      "hook:read:custom-run:1",
      "hook:echo:custom-run:2",
    ])

    // Without an explicit runId, a generated UUID prefixes every key.
    const auto = await Effect.runPromise(runtime.program(`return await tools.echo({ value: 1 })`).run())
    expect(auto).toMatchObject({ ok: true, value: expect.stringMatching(/^[0-9a-f-]{36}:0$/) })
  })

  test("Tool.idempotent and Tool.durable infer input from schema, data from start, union services across start/wait/cancel, and check output", async () => {
    class StartService extends Context.Service<StartService, { readonly prefix: string }>()("test/StartService") {}
    class WaitService extends Context.Service<WaitService, { readonly multiplier: number }>()("test/WaitService") {}
    class CancelService extends Context.Service<CancelService, { readonly onCancel: (id: string) => void }>()(
      "test/CancelService",
    ) {}

    const idempotentTyped = Tool.make({
      description: "Typed idempotent tool",
      input: Schema.Struct({ name: Schema.String }),
      output: Schema.String,
      execute: Tool.idempotent((input, { key }) => {
        const checkName: string = input.name
        // @ts-expect-error input is strictly typed from input schema, not any
        void input.nonexistent
        return Effect.succeed(`${checkName}:${key}`)
      }),
    })

    const durableTyped = Tool.make({
      description: "Typed durable tool",
      input: Schema.Struct({ name: Schema.String, count: Schema.Number }),
      output: Schema.Struct({ label: Schema.String }),
      execute: Tool.durable({
        start: (input, { key }) =>
          Effect.gen(function* () {
            const svc = yield* StartService
            const checkName: string = input.name
            // @ts-expect-error input is strictly typed from input schema, not any
            void input.nonexistent
            return { jobId: `${svc.prefix}:${checkName}:${key}`, attempts: input.count }
          }),
        wait: (data, { key }) =>
          Effect.gen(function* () {
            const svc = yield* WaitService
            const checkJobId: string = data.jobId
            const checkAttempts: number = data.attempts * svc.multiplier
            // @ts-expect-error wait receives start's exact data shape
            void data.nonexistent
            return { label: `${checkJobId}:${checkAttempts}:${key}` }
          }),
        cancel: (data) =>
          Effect.gen(function* () {
            const svc = yield* CancelService
            const checkJobId: string = data.jobId
            // @ts-expect-error cancel receives start's exact data shape
            void data.nonexistent
            svc.onCancel(checkJobId)
          }),
      }),
    })
    Tool.make({
      description: "Mismatched output",
      input: Value,
      output: Value,
      // @ts-expect-error wait output is checked against the tool's output schema
      execute: Tool.durable({
        start: () => Effect.succeed({ id: "1" }),
        wait: ({ id }) => Effect.succeed({ wrong: id }),
        cancel: () => Effect.void,
      }),
    })
    expect(idempotentTyped._tag).toBe("CodeModeTool")
    expect(durableTyped._tag).toBe("CodeModeTool")
    if (false as boolean) {
      // @ts-expect-error resolved Tool.execute is not callable without narrowing
      idempotentTyped.execute({ name: "a" }, { key: "k" })
      // @ts-expect-error resolved Tool.execute is not callable without narrowing
      durableTyped.execute({ name: "b", count: 1 }, { key: "k" })
    }

    const runtime = CodeMode.make({
      tools: { idem: idempotentTyped, dur: durableTyped },
    })
    const result = await Effect.runPromise(
      runtime
        .program(
          `return [await tools.idem({ name: "a" }), (await tools.dur({ name: "b", count: 3 })).label]`,
          undefined,
          { runId: "svc" },
        )
        .run()
        .pipe(
          Effect.provideService(StartService, { prefix: "p" }),
          Effect.provideService(WaitService, { multiplier: 10 }),
          Effect.provideService(CancelService, { onCancel: () => {} }),
        ),
    )
    expect(result).toEqual({
      ok: true,
      value: ["a:svc:0", "p:b:svc:1:30:svc:1"],
      toolCalls: [{ name: "idem" }, { name: "dur" }],
    })
  })

  test("suspending a resumed program before run() starts waits for driver.resume() and leaves nothing running", async () => {
    const read = idempotentManual()
    const runtime = CodeMode.make({ tools: { read: read.tool } })
    const initial = background(
      runtime.program(`return (await tools.read({ value: 5 })).value`, undefined, { runId: "sr" }),
    )
    await read.called()
    const firstSuspended = suspendedOf(await Effect.runPromise(initial.suspend))

    // Re-suspend the resumed program immediately from another fiber before run() begins.
    read.reset()
    const secondSuspended = suspendedOf(
      await Effect.runPromise(
        Effect.gen(function* () {
          const resumed = runtime.resume(CodeMode.toBytes(firstSuspended.state))
          const fiber = yield* Effect.forkChild(resumed.run())
          const suspended = yield* resumed.suspend()
          expect(yield* Fiber.join(fiber)).toBe(suspended)
          return suspended
        }),
      ),
    )
    // If driver.resume() launched the idempotent call, suspending detached and interrupted it.
    for (const attempt of read.attempts) expect(attempt.interrupted).toBe(true)

    read.reset()
    const finalRun = background(runtime.resume(CodeMode.toBytes(secondSuspended.state)))
    await read.called()
    read.attempts[read.attempts.length - 1]!.answer(5)
    expect(await Effect.runPromise(finalRun.result)).toEqual({
      ok: true,
      value: 5,
      toolCalls: [{ name: "read" }],
    })
  })

  test("a detached idempotent or durable call that settles at a slice before interruption does not fire tool.after twice", async () => {
    const afterEvents: Array<string> = []
    let resolveIdem!: (value: number) => void
    let idemCalled = latch()
    const idem = Tool.make({
      description: "Idempotent settling on detach",
      input: Value,
      output: Value,
      execute: Tool.idempotent((input) =>
        Effect.promise(() => {
          idemCalled.resolve()
          return new Promise<number>((r) => {
            resolveIdem = r
          }).then((v) => ({ value: v + input.value }))
        }),
      ),
    })
    const runtime = CodeMode.make({
      tools: { idem },
      hooks: {
        "tool.after": (call, res) => Effect.sync(() => void afterEvents.push(`${call.key}:${res.status}`)),
      },
    })
    // Run a busy loop alongside the in-flight idempotent call so suspend lands at a slice.
    const code = `
      const p = tools.idem({ value: 1 })
      const started = Date.now()
      while (Date.now() - started < 300) {}
      return (await p).value`
    const run = background(runtime.program(code, undefined, { runId: "sl" }))
    await idemCalled.promise
    // Resolve the underlying promise right as suspend detaches, so the fiber settles with success while detaching.
    const suspendPromise = Effect.runPromise(run.suspend)
    resolveIdem(41)
    const suspended = suspendedOf(await suspendPromise)
    expect(afterEvents).toEqual([])

    idemCalled = latch()
    const resumed = background(runtime.resume(CodeMode.toBytes(suspended.state)))
    await idemCalled.promise
    resolveIdem(41)
    expect(await Effect.runPromise(resumed.result)).toEqual({
      ok: true,
      value: 42,
      toolCalls: [{ name: "idem" }],
    })
    expect(afterEvents).toEqual(["sl:0:success"])
  })

  test("invalid start JSON and wait failures fire tool.after with failure", async () => {
    // 1. Non-JSON data returned from start fires tool.after with failure.
    const badStartEvents: Array<string> = []
    const badStart = Tool.make({
      description: "Bad start data",
      input: Value,
      output: Value,
      execute: Tool.durable({
        start: () => {
          const circular: Record<string, unknown> = {}
          circular.self = circular
          return Effect.succeed(circular as unknown as CodeMode.DataValue)
        },
        wait: () => Effect.succeed({ value: 1 }),
        cancel: () => Effect.void,
      }),
    })
    const badOutcome = await Effect.runPromise(
      CodeMode.make({
        tools: { bad: badStart },
        hooks: {
          "tool.after": (call, res) => Effect.sync(() => void badStartEvents.push(`${call.key}:${res.status}`)),
        },
      })
        .program(`return await tools.bad({ value: 1 })`, undefined, { runId: "bad" })
        .run(),
    )
    expect(badOutcome).toMatchObject({ ok: false, error: { kind: "InvalidToolOutput" } })
    expect(badStartEvents).toEqual(["bad:0:failure"])

    // 2. A failing wait rejects the call's promise with a catchable ToolError and fires tool.after with failure.
    const waitEvents: Array<string> = []
    const failingWait = Tool.make({
      description: "Failing wait",
      input: Value,
      output: Value,
      execute: Tool.durable({
        start: (input, { key }) => Effect.succeed({ key, v: input.value }),
        wait: ({ key }) => Effect.fail(new Error(`wait boom ${key}`)),
        cancel: () => Effect.void,
      }),
    })
    const caughtWait = await Effect.runPromise(
      CodeMode.make({
        tools: { failWait: failingWait },
        hooks: {
          "tool.after": (call, res) => Effect.sync(() => void waitEvents.push(`${call.key}:${res.status}`)),
        },
      })
        .program(
          `try { return await tools.failWait({ value: 1 }) } catch (e) { return [e.name, e.message] }`,
          undefined,
          { runId: "wf" },
        )
        .run(),
    )
    expect(caughtWait).toEqual({
      ok: true,
      value: ["Error", "wait boom wf:0"],
      toolCalls: [{ name: "failWait" }],
    })
    expect(waitEvents).toEqual(["wf:0:failure"])
  })

  test("resuming a started durable call fails with SnapshotError when the tool was removed or is no longer durable, and completed calls clear their data", async () => {
    const jobs = durableJobs()
    const read = idempotentManual()
    const runtime = CodeMode.make({ tools: { job: jobs.tool, read: read.tool } })
    const run = background(
      runtime.program(
        `const first = await tools.job({ value: 1 }); const second = await tools.read({ value: 2 }); return first.value + second.value`,
        undefined,
        { runId: "chg" },
      ),
    )
    await jobs.waiting()
    const suspendedWhileStarted = suspendedOf(await Effect.runPromise(run.suspend))

    // Removing the tool or changing it to plain/idempotent refuses resume with SnapshotError.
    const plainTool = Tool.make({
      description: "Plain",
      input: Value,
      output: Value,
      execute: (input) => Effect.succeed(input),
    })
    const toolSets: ReadonlyArray<Record<string, Tool.Tool>> = [{}, { job: plainTool }, { job: read.tool }]
    for (const tools of toolSets) {
      expect(
        (await refusal(CodeMode.make({ tools }).resume(suspendedWhileStarted.state))).message,
      ).toContain("cannot resume because that tool is no longer a durable tool")
    }

    // Complete `job` while `read` is still running: `job` moves to the inbox with its `data` cleared.
    const jobs2 = durableJobs()
    const read2 = idempotentManual()
    const run2 = background(
      CodeMode.make({ tools: { job: jobs2.tool, read: read2.tool } }).program(
        `const [a, b] = await Promise.all([tools.job({ value: 1 }), tools.read({ value: 2 })]); return a.value + b.value`,
        undefined,
        { runId: "chg2" },
      ),
    )
    await Promise.all([jobs2.waiting(), read2.called()])
    jobs2.finish("chg2:0", 10)
    await Bun.sleep(10)
    const suspendedAfterJob = suspendedOf(await Effect.runPromise(run2.suspend))
    expect(JSON.stringify(suspendedAfterJob.state)).not.toContain('"tags"')
    read2.reset()
    const resumedAfterJob = background(
      CodeMode.make({ tools: { job: jobs2.tool, read: read2.tool } }).resume(suspendedAfterJob.state),
    )
    await read2.called()
    read2.attempts[1]!.answer(20)
    expect(await Effect.runPromise(resumedAfterJob.result)).toEqual({
      ok: true,
      value: 30,
      toolCalls: [{ name: "job" }, { name: "read" }],
    })
  })
})

describe("extension snapshot hooks", () => {
  type Saved = {
    readonly url: string
    readonly status: number
    readonly headers: ReadonlyArray<readonly [string, string]>
    readonly body: Uint8Array
  }
  const savedSymbol = Symbol("saved")

  /** A fetch-like extension whose resolved responses save and restore their methods through `snapshot` hooks. */
  const web = (snapshot: Partial<Extension.Snapshot> = {}) => {
    const counts = { encode: 0, decode: 0 }
    const makeResponse = (saved: Saved) => {
      const headers = Object.fromEntries(saved.headers)
      const text = () => new TextDecoder().decode(saved.body)
      return {
        [savedSymbol]: saved,
        url: saved.url,
        status: saved.status,
        ok: saved.status >= 200 && saved.status <= 299,
        headers: {
          get: (name: string) => headers[name.toLowerCase()] ?? null,
          has: (name: string) => name.toLowerCase() in headers,
        },
        text: async () => text(),
        json: async () => JSON.parse(text()) as unknown,
        bytes: async () => saved.body,
      }
    }
    const extension = Extension.make({
      name: "fetch",
      globals: {
        fetch: Extension.async(async (url: string) =>
          makeResponse({
            url,
            status: 200,
            headers: [["x-id", "7"]],
            body: new TextEncoder().encode(JSON.stringify({ url, ok: true })),
          }),
        ),
      },
      snapshot: {
        encode: (value) => (counts.encode++, (value as { readonly [savedSymbol]: Saved })[savedSymbol]),
        decode: (data) => (counts.decode++, makeResponse(data as Saved)),
        ...snapshot,
      },
    })
    return { extension, counts }
  }

  const code = `
    const res = await fetch("https://a.test/")
    const text = res.text
    const header = res.headers.get
    await tools.job({ value: 1 })
    return [await text(), await res.json(), header("x-id"), res.headers.has("x-id"), [...(await res.bytes())].length, res.url, res.ok]`

  const suspendWith = async (extension: Extension.Extension) => {
    const jobs = durableJobs()
    const run = background(
      CodeMode.make({ tools: { job: jobs.tool }, extensions: [extension] }).program(code, undefined, {
        runId: "h",
      }),
    )
    await jobs.waiting()
    return { jobs, run }
  }

  test("methods on an extension-returned response survive suspend and resume in a fresh runtime", async () => {
    const { extension, counts } = web()
    const { jobs, run } = await suspendWith(extension)
    const encodedBefore = counts.encode
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    expect(suspended.state.records.filter((record) => record.t === "HostValue")).toHaveLength(1)
    expect(counts.encode - encodedBefore).toBe(1)

    jobs.reset()
    const fresh = web()
    const resumed = background(
      CodeMode.make({ tools: { job: jobs.tool }, extensions: [fresh.extension] }).resume(
        CodeMode.toBytes(suspended.state),
      ),
    )
    await jobs.waiting()
    expect(fresh.counts).toEqual({ encode: 0, decode: 1 })
    jobs.finish("h:1", 1)
    const outcome = await Effect.runPromise(resumed.result)
    expect(outcome).toEqual({
      ok: true,
      value: [
        '{"url":"https://a.test/","ok":true}',
        { url: "https://a.test/", ok: true },
        "7",
        true,
        35,
        "https://a.test/",
        true,
      ],
      toolCalls: [{ name: "job" }],
    })
  })

  test("a suspend fails, and the run goes on, when encode throws or returns non-plain data", async () => {
    const cases: ReadonlyArray<readonly [Partial<Extension.Snapshot>, string]> = [
      [
        { encode: () => undefined },
        "The run's state couldn't be saved: The extension \"fetch\" saved a value it returned as data holding undefined; snapshot.encode must give plain data (JSON values and Uint8Arrays).",
      ],
      [
        { encode: () => ({ when: new Date(0) }) },
        "The run's state couldn't be saved: The extension \"fetch\" saved a value it returned as data holding a Date; snapshot.encode must give plain data (JSON values and Uint8Arrays).",
      ],
      [
        { encode: () => ({ run: () => 1 }) },
        "The run's state couldn't be saved: The extension \"fetch\" saved a value it returned as data holding a function; snapshot.encode must give plain data (JSON values and Uint8Arrays).",
      ],
      [
        {
          encode: () => {
            throw new Error("no")
          },
        },
        "The run's state couldn't be saved: The extension \"fetch\" couldn't save a value it returned: no",
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
        value: [
          '{"url":"https://a.test/","ok":true}',
          { url: "https://a.test/", ok: true },
          "7",
          true,
          35,
          "https://a.test/",
          true,
        ],
      })
    }
  })

  test("a Buffer or Uint8Array view returned by snapshot.encode copies only its slice, not the underlying slab", async () => {
    const slab = new ArrayBuffer(8192)
    const view = new Uint8Array(slab, 100, 4)
    view.set(new TextEncoder().encode('"hi"'))
    const { extension } = web({
      encode: (value) => ({
        ...(value as { readonly [savedSymbol]: Saved })[savedSymbol],
        body: Buffer.from(view.buffer, view.byteOffset, view.byteLength),
      }),
    })
    const { jobs, run } = await suspendWith(extension)
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    // The serialized ArrayBuffer record holds only the 4-byte slice, not the 8 KiB slab.
    expect(suspended.state.records.filter((r) => r.t === "ArrayBuffer")).toEqual([
      { t: "ArrayBuffer", d: btoa('"hi"') },
    ])
    const fresh = web()
    const resumed = background(
      CodeMode.make({ tools: { job: jobs.tool }, extensions: [fresh.extension] }).resume(
        CodeMode.toBytes(suspended.state),
      ),
    )
    await jobs.waiting()
    jobs.finish("h:1", 1)
    expect(await Effect.runPromise(resumed.result)).toEqual({
      ok: true,
      value: ['"hi"', "hi", "7", true, 4, "https://a.test/", true],
      toolCalls: [{ name: "job" }],
    })
  })

  test("a state that holds a hooked value is refused without that extension or without its hooks", async () => {
    const { extension } = web()
    const { jobs, run } = await suspendWith(extension)
    const suspended = suspendedOf(await Effect.runPromise(run.suspend))
    const unhooked = Extension.make({ name: "fetch", globals: extension.globals })
    const other = Extension.make({ name: "other", globals: extension.globals, snapshot: extension.snapshot })
    for (const extensions of [[], [unhooked], [other]]) {
      expect(
        (await refusal(CodeMode.make({ tools: { job: jobs.tool }, extensions }).resume(suspended.state)))
          .message,
      ).toBe("This state was saved by a runtime with other host globals (extensions); resume it with the same ones.")
    }
  })
})
