import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import z from "zod"
import { Tool } from "../../src/tool/tool"

const params = z.object({ input: z.string() })

function makeTool(id: string, executeFn?: () => void) {
  return {
    description: "test tool",
    parameters: params,
    execute() {
      executeFn?.()
      return Effect.succeed({ title: "test", output: "ok", metadata: {} })
    },
  }
}

describe("Tool.define", () => {
  test("object-defined tool does not mutate the original init object", async () => {
    const original = makeTool("test")
    const originalExecute = original.execute

    const info = await Effect.runPromise(Tool.define("test-tool", Effect.succeed(original)))

    await info.init()
    await info.init()
    await info.init()

    expect(original.execute).toBe(originalExecute)
  })

  test("function-defined tool returns fresh objects and is unaffected", async () => {
    const info = await Effect.runPromise(
      Tool.define(
        "test-fn-tool",
        Effect.succeed(() => Promise.resolve(makeTool("test"))),
      ),
    )

    const first = await info.init()
    const second = await info.init()

    expect(first).not.toBe(second)
  })

  test("object-defined tool returns distinct objects per init() call", async () => {
    const info = await Effect.runPromise(Tool.define("test-copy", Effect.succeed(makeTool("test"))))

    const first = await info.init()
    const second = await info.init()

    expect(first).not.toBe(second)
  })
})
