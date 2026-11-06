import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect, Fiber, Schema } from "effect"
import { CodeMode, Extension, Tool } from "../../src/index.js"

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
    engine: "vm",
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
      const runtime = CodeMode.make({ engine: "vm", extensions: [draw.extension] })
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
      CodeMode.make({ engine: "vm", extensions: [draw.extension], limits: { timeoutMs: 100 } }).execute(
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
        background(CodeMode.make({ engine: "vm", tools: { step: step.tool } }).resume(state)).result,
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
      engine: "vm",
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
      const run = background(runtime.program(code))
      await running()
      const error = await blocked(run)
      expect(error, name).toBeInstanceOf(CodeMode.SuspendError)
      expect(error.running, name).toEqual([{ path }])
      expect(error.message, name).toBe(`The run can't be suspended while ${path} is running.`)
      release()
      expect(await Effect.runPromise(run.result), name).toMatchObject({ ok: true, value })
    }
  })

  test("every running call that blocks a suspend is named", async () => {
    const slow = manual()
    const run = background(
      CodeMode.make({ engine: "vm", tools: { slow: slow.tool, "a-b": { work: slow.tool } } }).program(
        `return await Promise.all([tools["a-b"].work({ value: 1 }), tools.slow({ value: 2 })])`,
      ),
    )
    while (slow.calls.length < 2) await Bun.sleep(1)
    expect((await blocked(run)).running).toEqual([{ path: 'tools["a-b"].work' }, { path: "tools.slow" }])
  })

  test("a suspend after the run ended gives its result", async () => {
    const program = CodeMode.make({ engine: "vm" }).program(`return 1 + 1`)
    expect(await Effect.runPromise(program.run())).toEqual({ ok: true, value: 2, toolCalls: [] })
    expect(await Effect.runPromise(program.suspend())).toEqual({ ok: true, value: 2, toolCalls: [] })
  })

  test("a program runs inline in the current fiber", async () => {
    const runtime = CodeMode.make({ engine: "vm", tools: { step: stepTool().tool } })
    expect(
      await Effect.runPromise(runtime.program(`return (await tools.step({ value: x })).value`, { x: 21 }).run()),
    ).toEqual({ ok: true, value: 42, toolCalls: [{ name: "step" }] })
  })

  test("a suspend from another fiber stops a background run, which returns the same state", async () => {
    const runtime = CodeMode.make({ engine: "vm", tools: {} })
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
    const fresh = CodeMode.make({ engine: "vm", tools: {} })
    expect(await Effect.runPromise(fresh.resume(CodeMode.toBytes(suspendedOf(suspended).state)).run())).toEqual(
      expected,
    )
  })

  test("a program runs once", async () => {
    const program = CodeMode.make({ engine: "vm" }).program(`return 1`)
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
    const program = CodeMode.make({ engine: "vm", tools: { hang } }).program(`return await tools.hang({ value: 1 })`)
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
    const program = CodeMode.make({ engine: "vm" }).program("return 1")
    expect(() => program.suspend({ maxBytes: -1 })).toThrow(RangeError)
  })

  test("only a VM runtime has program and resume", () => {
    const vm = CodeMode.make({ engine: "vm" })
    expect([typeof vm.program, typeof vm.resume]).toEqual(["function", "function"])
    for (const legacy of [CodeMode.make(), CodeMode.make({ engine: "legacy" })]) {
      // @ts-expect-error only engine: "vm" runs programs one by one
      void legacy.program
      // @ts-expect-error only engine: "vm" resumes runs
      void legacy.resume
      expect("program" in legacy || "resume" in legacy).toBe(false)
    }
  })

  test("the snapshot codec does not import Effect", async () => {
    for (const file of ["codec.ts", "snapshot.ts"]) {
      expect(await Bun.file(path.join(import.meta.dir, "../../src/vm/snapshot", file)).text()).not.toMatch(
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
      CodeMode.make({ engine: "vm", tools: { slow: step.tool } }).program(`
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
      const child = Bun.spawn(["bun", path.join(import.meta.dir, "../fixtures/resume-process.ts"), file], {
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
      background(CodeMode.make({ engine: "vm", tools: { step: step.tool } }).resume(suspended.state)).result,
    )
    expect(result).toMatchObject({ ok: false, error: { kind: "ToolCallLimitExceeded" } })

    const { step: step2, run: long } = await suspendBetweenCalls(
      `await tools.step({ value: 1 }); const t = Date.now(); while (Date.now() - t < 300) {} return "x".repeat(100)`,
      { limits: { maxOutputBytes: 10 } },
    )
    const saved = suspendedOf(await Effect.runPromise(long.suspend))
    expect(
      await Effect.runPromise(
        background(CodeMode.make({ engine: "vm", tools: { step: step2.tool } }).resume(saved.state)).result,
      ),
    ).toMatchObject({ ok: true, truncated: true })
  })

  test("active time and tool calls count across resumes", async () => {
    const step = stepTool()
    const runtime = CodeMode.make({ engine: "vm", tools: { step: step.tool }, limits: { timeoutMs: 300 } })
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
        CodeMode.make({ engine: "vm", tools: { step: step.tool }, extensions: [extension] }).resume(suspended.state),
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
      background(CodeMode.make({ engine: "vm", tools: { step: step.tool } }).resume(CodeMode.toBytes(suspended.state)))
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
    const runtime = CodeMode.make({ engine: "vm", tools: { step: step.tool } })
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
