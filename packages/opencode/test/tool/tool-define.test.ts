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

    // The original object's execute should never be overwritten
    expect(original.execute).toBe(originalExecute)
  })

  test("object-defined tool does not accumulate wrapper layers across init() calls", async () => {
    let executeCalls = 0

    const tool = Tool.define("test-tool", makeTool("test", () => executeCalls++))

    // Call init() many times to simulate many agentic steps
    for (let i = 0; i < 100; i++) {
      await tool.init()
    }

    // Resolve the tool and call execute
    const resolved = await tool.init()
    executeCalls = 0

    // Capture the stack trace inside execute to measure wrapper depth
    let stackInsideExecute = ""
    const origExec = resolved.execute
    resolved.execute = async (args: any, ctx: any) => {
      const result = await origExec.call(resolved, args, ctx)
      const err = new Error()
      stackInsideExecute = err.stack || ""
      return result
    }

    await resolved.execute(defaultArgs, {} as any)
    expect(executeCalls).toBe(1)

    // Count how many times tool.ts appears in the stack.
    // With the fix: 1 wrapper layer (from the most recent init()).
    // Without the fix: 101 wrapper layers from accumulated closures.
    const toolTsFrames = stackInsideExecute.split("\n").filter((l) => l.includes("tool.ts")).length
    expect(toolTsFrames).toBeLessThan(5)
  })

  test("function-defined tool returns fresh objects and is unaffected", async () => {
    const tool = Tool.define("test-fn-tool", () => Promise.resolve(makeTool("test")))

    const first = await tool.init()
    const second = await tool.init()

    // Function-defined tools return distinct objects each time
    expect(first).not.toBe(second)
  })

  test("object-defined tool returns distinct objects per init() call", async () => {
    const tool = Tool.define("test-copy", makeTool("test"))

    const first = await tool.init()
    const second = await tool.init()

    // Each init() should return a separate object so wrappers don't accumulate
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
