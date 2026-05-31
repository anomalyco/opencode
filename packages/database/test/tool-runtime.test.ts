import { describe, expect, it } from "bun:test"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { ToolRuntime, ToolRuntimeError } from "../src/tool/runtime"

const toolsDir = `${import.meta.dirname}/fixtures/tools`

const run = <A, E>(effect: Effect.Effect<A, E, ToolRuntime>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, ToolRuntime.layer))

describe("ToolRuntime", () => {
  it("registers a tool and returns its signature", async () => {
    const result = await run(
      Effect.gen(function* () {
        const runtime = yield* ToolRuntime
        return yield* runtime.register("add", `${toolsDir}/add.ts`)
      }),
    )
    expect(result.name).toBe("add")
    expect(result.description).toBe("Add two numbers")
    expect(result.input).toEqual({ a: "number", b: "number" })
    expect(result.output).toEqual({ result: "number" })
  })

  it("executes a registered tool", async () => {
    const result = await run(
      Effect.gen(function* () {
        const runtime = yield* ToolRuntime
        yield* runtime.register("add", `${toolsDir}/add.ts`)
        return yield* runtime.execute("add", { a: 2, b: 3 })
      }),
    )
    expect(result).toEqual({ result: 5 })
  })

  it("fails when executing an unregistered tool", async () => {
    const result = await run(
      Effect.gen(function* () {
        const runtime = yield* ToolRuntime
        return yield* runtime.execute("nonexistent", {}).pipe(Effect.flip)
      }),
    )
    expect(result).toBeInstanceOf(ToolRuntimeError)
  })

  it("lists registered tools", async () => {
    const result = await run(
      Effect.gen(function* () {
        const runtime = yield* ToolRuntime
        yield* runtime.register("add", `${toolsDir}/add.ts`)
        return yield* runtime.list()
      }),
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe("add")
  })

  it("unregisters a tool", async () => {
    const result = await run(
      Effect.gen(function* () {
        const runtime = yield* ToolRuntime
        yield* runtime.register("add", `${toolsDir}/add.ts`)
        yield* runtime.unregister("add")
        return yield* runtime.isRegistered("add")
      }),
    )
    expect(result).toBe(false)
  })

  it("reloads a tool with new file", async () => {
    const result = await run(
      Effect.gen(function* () {
        const runtime = yield* ToolRuntime
        yield* runtime.register("add", `${toolsDir}/add.ts`)
        // reload with same file
        return yield* runtime.reload("add", `${toolsDir}/add.ts`)
      }),
    )
    expect(result.name).toBe("add")
  })

  it("supports stateful tools across calls", async () => {
    const modulePath = `${toolsDir}/_counter.ts`
    await Bun.write(
      modulePath,
      [
        "let count = 0",
        "export const tool = {",
        '  name: "counter",',
        '  description: "Increment counter",',
        "  schema: { input: {}, output: { count: 'number' } },",
        "}",
        "export default function counter() {",
        "  count++",
        "  return { count }",
        "}",
      ].join("\n"),
    )

    const result = await run(
      Effect.gen(function* () {
        const runtime = yield* ToolRuntime
        yield* runtime.register("counter", modulePath)
        const r1 = yield* runtime.execute("counter", {})
        const r2 = yield* runtime.execute("counter", {})
        const r3 = yield* runtime.execute("counter", {})
        return { r1, r2, r3 }
      }),
    )
    expect(result.r1).toEqual({ count: 1 })
    expect(result.r2).toEqual({ count: 2 })
    expect(result.r3).toEqual({ count: 3 })
  })
})
