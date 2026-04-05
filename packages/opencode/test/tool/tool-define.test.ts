import { describe, test, expect } from "bun:test"
import z from "zod"
import { Tool } from "../../src/tool/tool"

const params = z.object({ input: z.string() })
const defaultArgs = { input: "test" }

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

  test("object-defined tool does not accumulate wrapper layers across init() calls", async () => {
    let calls = 0

    const tool = Tool.define(
      "test-tool",
      makeTool("test", () => calls++),
    )

    for (let i = 0; i < 100; i++) {
      await tool.init()
    }

    const resolved = await tool.init()
    calls = 0

    let stack = ""
    const exec = resolved.execute
    resolved.execute = async (args: any, ctx: any) => {
      const result = await exec.call(resolved, args, ctx)
      stack = new Error().stack || ""
      return result
    }

    await resolved.execute(defaultArgs, {} as any)
    expect(calls).toBe(1)

    const frames = stack.split("\n").filter((l) => l.includes("tool.ts")).length
    expect(frames).toBeLessThan(5)
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

  test("validation still works after many init() calls", async () => {
    const tool = Tool.define("test-validation", {
      description: "validation test",
      parameters: z.object({ count: z.number().int().positive() }),
      async execute(args) {
        return { title: "test", output: String(args.count), metadata: {} }
      },
    })

    for (let i = 0; i < 100; i++) {
      await tool.init()
    }

    const resolved = await tool.init()

    const result = await resolved.execute({ count: 42 }, {} as any)
    expect(result.output).toBe("42")

    await expect(resolved.execute({ count: -1 }, {} as any)).rejects.toThrow("invalid arguments")
  })
})
