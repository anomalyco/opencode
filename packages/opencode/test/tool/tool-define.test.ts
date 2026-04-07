import { afterEach, describe, test, expect, mock } from "bun:test"
import z from "zod"
import { Tool } from "../../src/tool/tool"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
})

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
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
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
      },
    })
  })

  test("skips truncation when metadata.truncated is already set to false", async () => {
    const big = "x".repeat(200_000)
    const tool = Tool.define("test-raw", {
      description: "raw output tool",
      parameters: params,
      async execute() {
        return { title: "test", output: big, metadata: { truncated: false } }
      },
    })

    const resolved = await tool.init()
    const result = await resolved.execute(defaultArgs, {} as any)

    // The wrap() layer should skip Truncate.output() because truncated is already defined
    expect(result.output).toBe(big)
    expect(result.metadata.truncated).toBe(false)
  })

  test("applies truncation when metadata.truncated is undefined", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const big = "x".repeat(200_000)
        const tool = Tool.define("test-truncate", {
          description: "truncated output tool",
          parameters: params,
          async execute() {
            return { title: "test", output: big, metadata: {} as Record<string, any> }
          },
        })

        const resolved = await tool.init()
        const result = await resolved.execute(defaultArgs, {} as any)

        // The wrap() layer should apply Truncate.output() because truncated is undefined
        expect(result.metadata.truncated).toBe(true)
        expect(result.output.length).toBeLessThan(big.length)
      },
    })
  })

  test("skips truncation when metadata.truncated is false and output is small", async () => {
    const small = "hello world"
    const tool = Tool.define("test-raw-small", {
      description: "small raw output tool",
      parameters: params,
      async execute() {
        return { title: "test", output: small, metadata: { truncated: false } }
      },
    })

    const resolved = await tool.init()
    const result = await resolved.execute(defaultArgs, {} as any)

    // truncated: false should be preserved even for small output
    expect(result.output).toBe(small)
    expect(result.metadata.truncated).toBe(false)
  })

  test("skips truncation when metadata.truncated is already set to true", async () => {
    const big = "x".repeat(200_000)
    const tool = Tool.define("test-raw-true", {
      description: "pre-truncated output tool",
      parameters: params,
      async execute() {
        return { title: "test", output: big, metadata: { truncated: true, outputPath: "/tmp/out.txt" } }
      },
    })

    const resolved = await tool.init()
    const result = await resolved.execute(defaultArgs, {} as any)

    // When truncated is already true, wrap() should NOT re-truncate
    expect(result.output).toBe(big)
    expect(result.metadata.truncated).toBe(true)
    expect(result.metadata.outputPath).toBe("/tmp/out.txt")
  })
})
