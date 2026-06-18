import { describe, expect, test } from "bun:test"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"

import { McpCatalog } from "../../src/mcp/catalog"

function toolClient(calls: Record<string, unknown>[]) {
  return {
    callTool: async (request: { arguments?: Record<string, unknown> }) => {
      calls.push(request.arguments ?? {})
      return { content: [{ type: "text" as const, text: "ok" }] }
    },
  } as unknown as Client
}

describe("McpCatalog.convertTool", () => {
  test("parses JSON strings for object-shaped arguments", async () => {
    const calls: Record<string, unknown>[] = []
    const tool = McpCatalog.convertTool(
      {
        name: "send-mail",
        inputSchema: {
          type: "object",
          properties: {
            body: {
              type: "object",
              properties: {
                subject: { type: "string" },
              },
            },
          },
        },
      },
      toolClient(calls),
    )

    await tool.execute?.({ body: '{"subject":"hello"}' }, { toolCallId: "call", messages: [], abortSignal: undefined })

    expect(calls).toEqual([{ body: { subject: "hello" } }])
  })

  test("converts empty strings to empty objects for object-shaped arguments", async () => {
    const calls: Record<string, unknown>[] = []
    const tool = McpCatalog.convertTool(
      {
        name: "nextjs_call",
        inputSchema: {
          type: "object",
          properties: {
            args: { type: "object", properties: {} },
          },
        },
      },
      toolClient(calls),
    )

    await tool.execute?.({ args: "" }, { toolCallId: "call", messages: [], abortSignal: undefined })

    expect(calls).toEqual([{ args: {} }])
  })

  test("leaves invalid JSON strings unchanged", async () => {
    const calls: Record<string, unknown>[] = []
    const tool = McpCatalog.convertTool(
      {
        name: "nextjs_call",
        inputSchema: {
          type: "object",
          properties: {
            args: { type: "object", properties: {} },
          },
        },
      },
      toolClient(calls),
    )

    await tool.execute?.({ args: "not json" }, { toolCallId: "call", messages: [], abortSignal: undefined })

    expect(calls).toEqual([{ args: "not json" }])
  })
})
