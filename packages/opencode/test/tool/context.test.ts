import { describe, expect, test, spyOn } from "bun:test"
import { ContextTool } from "../../src/tool/context"
import * as SessionModule from "../../src/session"
import * as ProviderModule from "../../src/provider/provider"

const ctx = {
  sessionID: "test-session",
  messageID: "test-message",
  callID: "test-call",
  agent: "test-agent",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

describe("tool.context_usage", () => {
  let messagesSpy: any
  let getModelSpy: any

  test("should return no_data status when no messages exist", async () => {
    messagesSpy = spyOn(SessionModule.Session, "messages").mockResolvedValue([])

    const tool = await ContextTool.init()
    const result = await tool.execute({}, ctx)

    expect(result.title).toBe("No context data")
    expect(result.output).toBe("No messages have been processed yet, so context usage is not available.")
    expect(result.metadata.status).toBe("no_data")
    expect(result.metadata.percentage).toBe(0)
    expect(result.metadata.tokens).toBe(0)
    expect(result.metadata.limit).toBe(0)
    expect(result.metadata.breakdown.input).toBe(0)
    expect(result.metadata.breakdown.output).toBe(0)
    expect(result.metadata.breakdown.reasoning).toBe(0)
    expect(result.metadata.breakdown.cacheRead).toBe(0)
    expect(result.metadata.breakdown.cacheWrite).toBe(0)
  })

  test("should return no_data status when only user messages exist", async () => {
    messagesSpy = spyOn(SessionModule.Session, "messages").mockResolvedValue([
      {
        info: {
          role: "user",
          id: "1",
          sessionID: "session1",
          time: { created: Date.now() },
          agent: "test",
          model: { providerID: "openai", modelID: "gpt-4" },
        },
        parts: [],
      },
    ])

    const tool = await ContextTool.init()
    const result = await tool.execute({}, ctx)

    expect(result.title).toBe("No context data")
    expect(result.metadata.status).toBe("no_data")
  })

  test("should calculate correct percentage for assistant messages", async () => {
    messagesSpy = spyOn(SessionModule.Session, "messages").mockResolvedValue([
      {
        info: {
          role: "assistant",
          id: "1",
          sessionID: "session1",
          time: { created: Date.now() },
          parentID: "parent",
          modelID: "gpt-4",
          providerID: "openai",
          mode: "chat",
          agent: "test",
          path: { cwd: "/test", root: "/test" },
          cost: 0.01,
          tokens: {
            input: 1000,
            output: 500,
            reasoning: 0,
            cache: { read: 100, write: 50 },
          },
        },
        parts: [],
      },
    ])

    getModelSpy = spyOn(ProviderModule.Provider, "getModel").mockResolvedValue({
      id: "gpt-4",
      limit: { context: 10000, output: 4096 },
      cost: { input: 0.03, output: 0.06 },
      options: {},
    } as any)

    const tool = await ContextTool.init()
    const result = await tool.execute({}, ctx)

    expect(result.title).toBe("Context usage: 17%")
    expect(result.metadata.percentage).toBe(17)
    expect(result.metadata.tokens).toBe(1650)
    expect(result.output).toContain("Context window usage: 17%")
    expect(result.output).toContain("Status: healthy")
  })

  test("should handle model without context limit", async () => {
    messagesSpy = spyOn(SessionModule.Session, "messages").mockResolvedValue([
      {
        info: {
          role: "assistant",
          id: "1",
          sessionID: "session1",
          time: { created: Date.now() },
          parentID: "parent",
          modelID: "test",
          providerID: "test",
          mode: "chat",
          agent: "test",
          path: { cwd: "/test", root: "/test" },
          cost: 0,
          tokens: {
            input: 1000,
            output: 500,
            reasoning: 0,
            cache: { read: 100, write: 50 },
          },
        },
        parts: [],
      },
    ])

    getModelSpy = spyOn(ProviderModule.Provider, "getModel").mockResolvedValue({
      id: "test",
      limit: { context: 0, output: 4096 },
      cost: { input: 0, output: 0 },
      options: {},
    } as any)

    const tool = await ContextTool.init()
    const result = await tool.execute({}, ctx)

    expect(result.metadata.percentage).toBe(0)
    expect(result.metadata.status).toBe("healthy")
  })

  test("should sum all token types correctly", async () => {
    messagesSpy = spyOn(SessionModule.Session, "messages").mockResolvedValue([
      {
        info: {
          role: "assistant",
          id: "1",
          sessionID: "session1",
          time: { created: Date.now() },
          parentID: "parent",
          modelID: "gpt-4",
          providerID: "openai",
          mode: "chat",
          agent: "test",
          path: { cwd: "/test", root: "/test" },
          cost: 0,
          tokens: {
            input: 2000,
            output: 1500,
            reasoning: 300,
            cache: { read: 500, write: 200 },
          },
        },
        parts: [],
      },
    ])

    getModelSpy = spyOn(ProviderModule.Provider, "getModel").mockResolvedValue({
      id: "gpt-4",
      limit: { context: 10000, output: 4096 },
      cost: { input: 0, output: 0 },
      options: {},
    } as any)

    const tool = await ContextTool.init()
    const result = await tool.execute({}, ctx)

    expect(result.metadata.tokens).toBe(4500)
    expect(result.metadata.breakdown.input).toBe(2000)
    expect(result.metadata.breakdown.output).toBe(1500)
    expect(result.metadata.breakdown.reasoning).toBe(300)
    expect(result.metadata.breakdown.cacheRead).toBe(500)
    expect(result.metadata.breakdown.cacheWrite).toBe(200)
  })

  test("should categorize status as healthy below 50%", async () => {
    messagesSpy = spyOn(SessionModule.Session, "messages").mockResolvedValue([
      {
        info: {
          role: "assistant",
          id: "1",
          sessionID: "session1",
          time: { created: Date.now() },
          parentID: "parent",
          modelID: "gpt-4",
          providerID: "openai",
          mode: "chat",
          agent: "test",
          path: { cwd: "/test", root: "/test" },
          cost: 0,
          tokens: { input: 2000, output: 1000, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [],
      },
    ])

    getModelSpy = spyOn(ProviderModule.Provider, "getModel").mockResolvedValue({
      id: "gpt-4",
      limit: { context: 10000, output: 4096 },
      cost: { input: 0, output: 0 },
      options: {},
    } as any)

    const tool = await ContextTool.init()
    const result = await tool.execute({}, ctx)

    expect(result.metadata.status).toBe("healthy")
  })

  test("should categorize status as moderate between 50-75%", async () => {
    messagesSpy = spyOn(SessionModule.Session, "messages").mockResolvedValue([
      {
        info: {
          role: "assistant",
          id: "1",
          sessionID: "session1",
          time: { created: Date.now() },
          parentID: "parent",
          modelID: "gpt-4",
          providerID: "openai",
          mode: "chat",
          agent: "test",
          path: { cwd: "/test", root: "/test" },
          cost: 0,
          tokens: { input: 4000, output: 2000, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [],
      },
    ])

    getModelSpy = spyOn(ProviderModule.Provider, "getModel").mockResolvedValue({
      id: "gpt-4",
      limit: { context: 10000, output: 4096 },
      cost: { input: 0, output: 0 },
      options: {},
    } as any)

    const tool = await ContextTool.init()
    const result = await tool.execute({}, ctx)

    expect(result.metadata.status).toBe("moderate")
  })

  test("should categorize status as warning between 75-90%", async () => {
    messagesSpy = spyOn(SessionModule.Session, "messages").mockResolvedValue([
      {
        info: {
          role: "assistant",
          id: "1",
          sessionID: "session1",
          time: { created: Date.now() },
          parentID: "parent",
          modelID: "gpt-4",
          providerID: "openai",
          mode: "chat",
          agent: "test",
          path: { cwd: "/test", root: "/test" },
          cost: 0,
          tokens: { input: 5000, output: 3500, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [],
      },
    ])

    getModelSpy = spyOn(ProviderModule.Provider, "getModel").mockResolvedValue({
      id: "gpt-4",
      limit: { context: 10000, output: 4096 },
      cost: { input: 0, output: 0 },
      options: {},
    } as any)

    const tool = await ContextTool.init()
    const result = await tool.execute({}, ctx)

    expect(result.metadata.status).toBe("warning")
  })

  test("should categorize status as critical above 90%", async () => {
    messagesSpy = spyOn(SessionModule.Session, "messages").mockResolvedValue([
      {
        info: {
          role: "assistant",
          id: "1",
          sessionID: "session1",
          time: { created: Date.now() },
          parentID: "parent",
          modelID: "gpt-4",
          providerID: "openai",
          mode: "chat",
          agent: "test",
          path: { cwd: "/test", root: "/test" },
          cost: 0,
          tokens: { input: 6000, output: 4000, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [],
      },
    ])

    getModelSpy = spyOn(ProviderModule.Provider, "getModel").mockResolvedValue({
      id: "gpt-4",
      limit: { context: 10000, output: 4096 },
      cost: { input: 0, output: 0 },
      options: {},
    } as any)

    const tool = await ContextTool.init()
    const result = await tool.execute({}, ctx)

    expect(result.metadata.status).toBe("critical")
  })
})
