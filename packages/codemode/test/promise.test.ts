import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Schema } from "effect"
import { CodeMode, Tool, toolError } from "../src/index.js"

// Wave 5 acceptance suite: first-class promise values. Un-awaited tool calls start eagerly as
// host work, `await` settles them, Promise.all/allSettled/race/resolve/reject are
// ordinary functions over arbitrary arrays mixing promises and plain values, and
// .then/.catch/.finally chain reactions onto any promise.

type Trace = {
  starts: Array<number>
  active: number
  maxActive: number
  completed: number
  interrupted: number
}

const makeTrace = (): Trace => ({ starts: [], active: 0, maxActive: 0, completed: 0, interrupted: 0 })

/**
 * Deterministic tool set: ordering and interruption are structural, never temporal.
 *
 * - `echo` settles immediately with its id.
 * - `gated` blocks until `open` releases the same id. Tool fibers start eagerly at the
 *   call site, so several gated calls are provably live at once before any `open` runs.
 * - `pending` never settles; tests assert its interruption instead of racing a timer.
 *
 * Real clocks remain only in the wall-clock timeout tests (`timeoutMs`, `stubborn`
 * cleanup), where elapsed time is the behavior under test.
 */
const echoTool = (trace: Trace) =>
  Tool.make({
    description: "Echo an id immediately",
    input: Schema.Struct({ id: Schema.Number }),
    output: Schema.Number,
    execute: ({ id }) =>
      Effect.sync(() => {
        trace.starts.push(id)
        trace.completed += 1
        return id
      }),
  })

const gatedTool = (trace: Trace, gate: (id: number) => Deferred.Deferred<void>) =>
  Tool.make({
    description: "Echo an id once its gate opens",
    input: Schema.Struct({ id: Schema.Number }),
    output: Schema.Number,
    execute: ({ id }) =>
      Effect.gen(function* () {
        trace.starts.push(id)
        trace.active += 1
        trace.maxActive = Math.max(trace.maxActive, trace.active)
        yield* Deferred.await(gate(id))
        trace.active -= 1
        trace.completed += 1
        return id
      }).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            trace.active -= 1
            trace.interrupted += 1
          }),
        ),
      ),
  })

const openTool = (gate: (id: number) => Deferred.Deferred<void>) =>
  Tool.make({
    description: "Open the gate for an id",
    input: Schema.Struct({ id: Schema.Number }),
    output: Schema.Boolean,
    execute: ({ id }) => Deferred.succeed(gate(id), undefined),
  })

const pendingTool = (trace: Trace) =>
  Tool.make({
    description: "Never settle",
    input: Schema.Struct({ id: Schema.Number }),
    output: Schema.Number,
    execute: ({ id }) =>
      Effect.gen(function* () {
        trace.starts.push(id)
        trace.active += 1
        trace.maxActive = Math.max(trace.maxActive, trace.active)
        return yield* Effect.never
      }).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            trace.active -= 1
            trace.interrupted += 1
          }),
        ),
      ),
  })

const failingTool = Tool.make({
  description: "Always refuse",
  input: Schema.Struct({}),
  output: Schema.String,
  execute: () => Effect.fail(toolError("Lookup refused")),
})

const interruptedTool = Tool.make({
  description: "Interrupt this call",
  input: Schema.Struct({}),
  output: Schema.String,
  execute: () => Effect.interrupt,
})

const completedTool = (trace: Trace) =>
  Tool.make({
    description: "Return the number of completed calls",
    input: Schema.Struct({}),
    output: Schema.Number,
    execute: () => Effect.succeed(trace.completed),
  })

/** Never settles, and holds interruption cleanup for `cleanupMs` so completion cleanup can outlast a timeout. */
const stubbornTool = (trace: Trace) =>
  Tool.make({
    description: "Never settle; clean up slowly when interrupted",
    input: Schema.Struct({ cleanupMs: Schema.Number }),
    output: Schema.Number,
    execute: ({ cleanupMs }) =>
      Effect.never.pipe(
        Effect.onInterrupt(() =>
          Effect.andThen(
            Effect.sleep(cleanupMs),
            Effect.sync(() => {
              trace.interrupted += 1
            }),
          ),
        ),
      ),
  })

const run = (
  code: string,
  options: { trace?: Trace; limits?: CodeMode.ExecutionLimits } = {},
): Promise<CodeMode.Result> => {
  const trace = options.trace ?? makeTrace()
  const gates = new Map<number, Deferred.Deferred<void>>()
  const gate = (id: number): Deferred.Deferred<void> => {
    const existing = gates.get(id)
    if (existing) return existing
    const created = Deferred.makeUnsafe<void>()
    gates.set(id, created)
    return created
  }
  return Effect.runPromise(
    CodeMode.execute({
      tools: {
        host: {
          echo: echoTool(trace),
          gated: gatedTool(trace, gate),
          open: openTool(gate),
          pending: pendingTool(trace),
          fail: failingTool,
          interrupt: interruptedTool,
          completed: completedTool(trace),
          stubborn: stubbornTool(trace),
        },
      },
      code,
      ...(options.limits ? { limits: options.limits } : {}),
    }),
  )
}

const error = async (code: string, options: { trace?: Trace; limits?: CodeMode.ExecutionLimits } = {}) => {
  const result = await run(code, options)
  if (result.ok) throw new Error(`expected failure, got value ${JSON.stringify(result.value)}`)
  return result.error
}

describe("first-class promise values", () => {
  test("awaiting the same promise twice settles once and never re-runs the call", async () => {
    const result = await run(`
      const p = tools.host.echo({ id: 7 })
      const x = await p
      const y = await p
      return [x, y]
    `)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual([7, 7])
    expect(result.toolCalls).toStrictEqual([{ name: "host.echo" }])
  })

  test("a never-awaited failing call preserves the result and reports the rejection", async () => {
    const result = await run(`
      tools.host.fail({})
      return "done"
    `)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toBe("done")
    expect(result.warnings).toStrictEqual([
      { kind: "ToolFailure", message: "Unhandled rejection from an un-awaited promise: Lookup refused" },
    ])
    expect(Schema.decodeUnknownSync(CodeMode.Result)(JSON.parse(JSON.stringify(result)))).toStrictEqual(result)
  })
})

describe("Promise.all over arbitrary arrays", () => {
  test("awaiting an aggregate repeatedly does not rerun its members", async () => {
    const result = await run(`
      const aggregate = Promise.all([tools.host.echo({ id: 7 })])
      return [await aggregate, await aggregate]
    `)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual([[7], [7]])
    expect(result.toolCalls).toStrictEqual([{ name: "host.echo" }])
  })

  test("exceeding maxToolCalls inside Promise.all is a ToolCallLimitExceeded diagnostic", async () => {
    const diagnostic = await error(
      `return await Promise.all([tools.host.echo({ id: 1 }), tools.host.echo({ id: 2 }), tools.host.echo({ id: 3 })])`,
      { limits: { maxToolCalls: 2 } },
    )
    expect(diagnostic.kind).toBe("ToolCallLimitExceeded")
  })
})
