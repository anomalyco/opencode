import { describe, test, expect } from "bun:test"
import z from "zod"
import { Tool } from "../../src/tool/tool"

const params = z.object({ input: z.string() })

function makeTool(id: string, executeFn?: () => void) {
  return {
    description: "test tool",
    parameters: params,
    async execute() {
      executeFn?.()
      return { title: "test", output: "ok", metadata: {} }
    },
  }
}

describe("Tool.define", () => {
  test("object-defined tool does not mutate the original init object", async () => {
    const original = makeTool("test")
    const originalExecute = original.execute

    const tool = Tool.define("test-tool", original)

    await tool.init()
    await tool.init()
    await tool.init()

    expect(original.execute).toBe(originalExecute)
  })

  test("function-defined tool returns fresh objects and is unaffected", async () => {
    const tool = Tool.define("test-fn-tool", () => Promise.resolve(makeTool("test")))

    const first = await tool.init()
    const second = await tool.init()

    expect(first).not.toBe(second)
  })

  test("object-defined tool returns distinct objects per init() call", async () => {
    const tool = Tool.define("test-copy", makeTool("test"))

    const first = await tool.init()
    const second = await tool.init()

    expect(first).not.toBe(second)
  })
})
