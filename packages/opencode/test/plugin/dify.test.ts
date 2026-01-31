import { describe, expect, test, mock } from "bun:test"
import { DifyPlugin } from "../../src/plugin/dify"
import type { PluginInput } from "@opencode-ai/plugin"

const mockSession = {
  messages: mock(async () => []),
}

const mockConfig = {
  get: mock(async () => ({ username: "testuser" })),
}

mock.module("../../src/session", () => ({ Session: mockSession }))
mock.module("../../src/config/config", () => ({ Config: mockConfig }))

describe("plugin.dify", () => {
  test("ignores non-dify providers", async () => {
    const plugin = await DifyPlugin({} as PluginInput)
    const output = { headers: {} }
    
    await plugin["chat.headers"]?.(
      {
        model: { providerID: "openai" },
        provider: {},
        sessionID: "test",
      } as any,
      output as any,
    )
    
    expect(output.headers).toEqual({})
  })

  test("sets user-id from config when not provided", async () => {
    const plugin = await DifyPlugin({} as PluginInput)
    const output = { headers: {} as any }
    
    await plugin["chat.headers"]?.(
      {
        model: { providerID: "dify" },
        provider: {},
        sessionID: "test",
      } as any,
      output as any,
    )
    
    expect(output.headers["user-id"]).toBe("testuser")
  })

  test("preserves existing user-id header", async () => {
    const plugin = await DifyPlugin({} as PluginInput)
    const output = { headers: { "user-id": "custom-user" } }
    
    await plugin["chat.headers"]?.(
      {
        model: { providerID: "dify" },
        provider: {},
        sessionID: "test",
      } as any,
      output as any,
    )
    
    expect(output.headers["user-id"]).toBe("custom-user")
  })

  test("merges headers from provider and model", async () => {
    const plugin = await DifyPlugin({} as PluginInput)
    const output = { headers: {} as any }
    
    await plugin["chat.headers"]?.(
      {
        model: { providerID: "dify", headers: { "model-header": "value2" } },
        provider: { options: { headers: { "provider-header": "value1" } } },
        sessionID: "test",
      } as any,
      output as any,
    )
    
    expect(output.headers["provider-header"]).toBe("value1")
    expect(output.headers["model-header"]).toBe("value2")
  })

  test("extracts conversationId from session history", async () => {
    mockSession.messages.mockResolvedValueOnce([
      {
        info: { role: "user" },
        parts: [{ type: "text", text: "hello" }],
      },
      {
        info: { role: "assistant" },
        parts: [
          {
            type: "text",
            text: "response",
            metadata: {
              difyWorkflowData: { conversationId: "conv-123" },
            },
          },
        ],
      },
    ] as any)

    const plugin = await DifyPlugin({} as PluginInput)
    const output = { headers: {} as any }
    
    await plugin["chat.headers"]?.(
      {
        model: { providerID: "dify" },
        provider: {},
        sessionID: "test",
      } as any,
      output as any,
    )
    
    expect(output.headers["chat-id"]).toBe("conv-123")
  })

  test("uses last assistant message conversationId", async () => {
    mockSession.messages.mockResolvedValueOnce([
      {
        info: { role: "assistant" },
        parts: [
          {
            type: "text",
            metadata: { difyWorkflowData: { conversationId: "conv-old" } },
          },
        ],
      },
      {
        info: { role: "assistant" },
        parts: [
          {
            type: "text",
            metadata: { difyWorkflowData: { conversationId: "conv-new" } },
          },
        ],
      },
    ] as any)

    const plugin = await DifyPlugin({} as PluginInput)
    const output = { headers: {} as any }
    
    await plugin["chat.headers"]?.(
      {
        model: { providerID: "dify" },
        provider: {},
        sessionID: "test",
      } as any,
      output as any,
    )
    
    expect(output.headers["chat-id"]).toBe("conv-new")
  })

  test("handles numeric conversationId", async () => {
    mockSession.messages.mockResolvedValueOnce([
      {
        info: { role: "assistant" },
        parts: [
          {
            type: "text",
            metadata: { difyWorkflowData: { conversationId: 12345 } },
          },
        ],
      },
    ] as any)

    const plugin = await DifyPlugin({} as PluginInput)
    const output = { headers: {} as any }
    
    await plugin["chat.headers"]?.(
      {
        model: { providerID: "dify" },
        provider: {},
        sessionID: "test",
      } as any,
      output as any,
    )
    
    expect(output.headers["chat-id"]).toBe("12345")
  })

  test("skips messages without conversationId", async () => {
    mockSession.messages.mockResolvedValueOnce([
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "no metadata" }],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "text", metadata: {} }],
      },
    ] as any)

    const plugin = await DifyPlugin({} as PluginInput)
    const output = { headers: {} as any }
    
    await plugin["chat.headers"]?.(
      {
        model: { providerID: "dify" },
        provider: {},
        sessionID: "test",
      } as any,
      output as any,
    )
    
    expect(output.headers["chat-id"]).toBeUndefined()
  })
})
