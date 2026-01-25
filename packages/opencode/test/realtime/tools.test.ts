import { describe, expect, test, mock } from "bun:test"
import z from "zod"
import { RealtimeTools } from "../../src/realtime/tools"

// Helper type for property assertions in tests
type JsonSchemaProperty = {
  type?: string
  description?: string
  enum?: string[]
  items?: JsonSchemaProperty
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
}

describe("RealtimeTools", () => {
  describe("toolToOpenAIFormat", () => {
    test("converts simple Zod schema to OpenAI function format", () => {
      const tool = {
        id: "test_tool",
        description: "A test tool",
        parameters: z.object({
          name: z.string().describe("The name parameter"),
          count: z.number().describe("A count value"),
        }),
        execute: async () => ({ title: "test", metadata: {}, output: "done" }),
      }

      const result = RealtimeTools.toolToOpenAIFormat(tool)

      expect(result.type).toBe("function")
      expect(result.name).toBe("test_tool")
      expect(result.description).toBe("A test tool")
      expect(result.parameters.type).toBe("object")
      expect(result.parameters.properties.name).toBeDefined()
      expect(result.parameters.properties.count).toBeDefined()
      expect(result.parameters.required).toContain("name")
      expect(result.parameters.required).toContain("count")
    })

    test("handles optional parameters correctly", () => {
      const tool = {
        id: "optional_tool",
        description: "Tool with optional params",
        parameters: z.object({
          required_param: z.string(),
          optional_param: z.string().optional(),
        }),
        execute: async () => ({ title: "test", metadata: {}, output: "done" }),
      }

      const result = RealtimeTools.toolToOpenAIFormat(tool)

      expect(result.parameters.required).toContain("required_param")
      expect(result.parameters.required).not.toContain("optional_param")
    })

    test("handles enum parameters", () => {
      const tool = {
        id: "enum_tool",
        description: "Tool with enum",
        parameters: z.object({
          mode: z.enum(["fast", "slow", "medium"]),
        }),
        execute: async () => ({ title: "test", metadata: {}, output: "done" }),
      }

      const result = RealtimeTools.toolToOpenAIFormat(tool)

      expect((result.parameters.properties.mode as JsonSchemaProperty).enum).toEqual(["fast", "slow", "medium"])
    })

    test("preserves parameter descriptions", () => {
      const tool = {
        id: "described_tool",
        description: "Tool with descriptions",
        parameters: z.object({
          path: z.string().describe("The file path to read"),
        }),
        execute: async () => ({ title: "test", metadata: {}, output: "done" }),
      }

      const result = RealtimeTools.toolToOpenAIFormat(tool)

      expect((result.parameters.properties.path as JsonSchemaProperty).description).toBe("The file path to read")
    })

    test("handles nested objects", () => {
      const tool = {
        id: "nested_tool",
        description: "Tool with nested object",
        parameters: z.object({
          config: z.object({
            timeout: z.number(),
            retries: z.number().optional(),
          }),
        }),
        execute: async () => ({ title: "test", metadata: {}, output: "done" }),
      }

      const result = RealtimeTools.toolToOpenAIFormat(tool)

      const config = result.parameters.properties.config as JsonSchemaProperty
      expect(config.type).toBe("object")
      expect(config.properties?.timeout).toBeDefined()
    })

    test("handles arrays", () => {
      const tool = {
        id: "array_tool",
        description: "Tool with array",
        parameters: z.object({
          items: z.array(z.string()),
        }),
        execute: async () => ({ title: "test", metadata: {}, output: "done" }),
      }

      const result = RealtimeTools.toolToOpenAIFormat(tool)

      const items = result.parameters.properties.items as JsonSchemaProperty
      expect(items.type).toBe("array")
      expect(items.items?.type).toBe("string")
    })
  })

  describe("toolsToOpenAIFormat", () => {
    test("converts multiple tools", () => {
      const tools = [
        {
          id: "tool1",
          description: "First tool",
          parameters: z.object({ a: z.string() }),
          execute: async () => ({ title: "test", metadata: {}, output: "done" }),
        },
        {
          id: "tool2",
          description: "Second tool",
          parameters: z.object({ b: z.number() }),
          execute: async () => ({ title: "test", metadata: {}, output: "done" }),
        },
      ]

      const result = RealtimeTools.toolsToOpenAIFormat(tools)

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe("tool1")
      expect(result[1].name).toBe("tool2")
    })
  })

  describe("createToolExecutor", () => {
    test("executes tool and returns result", async () => {
      const mockExecute = mock(async (args: unknown) => {
        const { value } = args as { value: string }
        return {
          title: "Test Result",
          metadata: { processed: true },
          output: `Processed: ${value}`,
        }
      })

      const tools: RealtimeTools.ToolInfo[] = [
        {
          id: "echo",
          description: "Echo tool",
          parameters: z.object({ value: z.string() }),
          execute: mockExecute,
        },
      ]

      const executor = RealtimeTools.createToolExecutor(tools)
      const result = await executor.execute({
        name: "echo",
        call_id: "call_123",
        arguments: '{"value": "hello"}',
      })

      expect(result.call_id).toBe("call_123")
      expect(result.output).toContain("Processed: hello")
      expect(mockExecute).toHaveBeenCalledWith({ value: "hello" }, expect.any(Object))
    })

    test("returns error for unknown tool", async () => {
      const executor = RealtimeTools.createToolExecutor([])
      const result = await executor.execute({
        name: "unknown_tool",
        call_id: "call_456",
        arguments: "{}",
      })

      expect(result.call_id).toBe("call_456")
      expect(result.output).toContain("error")
      expect(result.output).toContain("unknown_tool")
    })

    test("returns error for invalid JSON arguments", async () => {
      const tools = [
        {
          id: "test",
          description: "Test",
          parameters: z.object({ x: z.string() }),
          execute: async () => ({ title: "", metadata: {}, output: "" }),
        },
      ]

      const executor = RealtimeTools.createToolExecutor(tools)
      const result = await executor.execute({
        name: "test",
        call_id: "call_789",
        arguments: "not valid json",
      })

      expect(result.output).toContain("error")
    })

    test("returns error for validation failure", async () => {
      const tools = [
        {
          id: "strict",
          description: "Strict tool",
          parameters: z.object({
            count: z.number().min(0).max(100),
          }),
          execute: async () => ({ title: "", metadata: {}, output: "" }),
        },
      ]

      const executor = RealtimeTools.createToolExecutor(tools)
      const result = await executor.execute({
        name: "strict",
        call_id: "call_abc",
        arguments: '{"count": 999}',
      })

      expect(result.output).toContain("error")
    })

    test("handles execution errors gracefully", async () => {
      const tools = [
        {
          id: "failing",
          description: "Failing tool",
          parameters: z.object({}),
          execute: async () => {
            throw new Error("Intentional failure")
          },
        },
      ]

      const executor = RealtimeTools.createToolExecutor(tools)
      const result = await executor.execute({
        name: "failing",
        call_id: "call_def",
        arguments: "{}",
      })

      expect(result.output).toContain("error")
      expect(result.output).toContain("Intentional failure")
    })

    test("supports abort signal for cancellation", async () => {
      const abortController = new AbortController()
      let wasAborted = false

      const tools: RealtimeTools.ToolInfo[] = [
        {
          id: "long_running",
          description: "Long running tool",
          parameters: z.object({}),
          execute: async (_args: unknown, ctx: RealtimeTools.ExecuteContext) => {
            ctx.abort.addEventListener("abort", () => {
              wasAborted = true
            })
            // Simulate long operation
            await new Promise((resolve) => setTimeout(resolve, 100))
            return { title: "", metadata: {}, output: "completed" }
          },
        },
      ]

      const executor = RealtimeTools.createToolExecutor(tools)

      // Start execution
      const promise = executor.execute(
        {
          name: "long_running",
          call_id: "call_ghi",
          arguments: "{}",
        },
        { abort: abortController.signal },
      )

      // Abort immediately
      abortController.abort()

      await promise
      expect(wasAborted).toBe(true)
    })
  })

  describe("interruption handling", () => {
    test("cancel stops pending tool execution", async () => {
      let executionStarted = false
      let executionCompleted = false

      const tools: RealtimeTools.ToolInfo[] = [
        {
          id: "interruptible",
          description: "Interruptible tool",
          parameters: z.object({}),
          execute: async (_args: unknown, ctx: RealtimeTools.ExecuteContext) => {
            executionStarted = true
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                executionCompleted = true
                resolve(undefined)
              }, 1000)
              ctx.abort.addEventListener("abort", () => {
                clearTimeout(timeout)
                reject(new Error("Aborted"))
              })
            })
            return { title: "", metadata: {}, output: "done" }
          },
        },
      ]

      const executor = RealtimeTools.createToolExecutor(tools)

      const promise = executor.execute({
        name: "interruptible",
        call_id: "call_int",
        arguments: "{}",
      })

      // Cancel after a short delay
      await new Promise((resolve) => setTimeout(resolve, 10))
      executor.cancel("call_int")

      const result = await promise
      expect(executionStarted).toBe(true)
      expect(executionCompleted).toBe(false)
      expect(result.output).toContain("interrupted")
    })

    test("cancelAll stops all pending executions", async () => {
      const completedCalls: string[] = []

      const tools: RealtimeTools.ToolInfo[] = [
        {
          id: "slow",
          description: "Slow tool",
          parameters: z.object({ id: z.string() }),
          execute: async (args: unknown, ctx: RealtimeTools.ExecuteContext) => {
            const { id } = args as { id: string }
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                completedCalls.push(id)
                resolve(undefined)
              }, 500)
              ctx.abort.addEventListener("abort", () => {
                clearTimeout(timeout)
                reject(new Error("Aborted"))
              })
            })
            return { title: "", metadata: {}, output: id }
          },
        },
      ]

      const executor = RealtimeTools.createToolExecutor(tools)

      // Start multiple executions
      const promises = [
        executor.execute({ name: "slow", call_id: "c1", arguments: '{"id":"1"}' }),
        executor.execute({ name: "slow", call_id: "c2", arguments: '{"id":"2"}' }),
        executor.execute({ name: "slow", call_id: "c3", arguments: '{"id":"3"}' }),
      ]

      // Cancel all after a short delay
      await new Promise((resolve) => setTimeout(resolve, 10))
      executor.cancelAll()

      await Promise.all(promises)
      expect(completedCalls).toHaveLength(0)
    })
  })
})
