import { describe, expect, test } from "bun:test"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { convertTool } from "../../src/mcp/catalog"

type ExecutableTool = {
  execute: (args: unknown, options: { abortSignal?: AbortSignal }) => Promise<any>
}

describe("MCP catalog", () => {
  test("preserves image content when structured content is present", async () => {
    const image = {
      type: "image" as const,
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
      mimeType: "image/png",
    }
    const client = {
      callTool: async () => ({
        content: [image],
        structuredContent: { ok: true },
        isError: false,
      }),
    } as unknown as Client
    const definition = {
      name: "image_only_result",
      inputSchema: { type: "object", properties: {} },
    } as MCPToolDef

    const tool = convertTool(definition, client) as ExecutableTool
    const result = await tool.execute({}, {})

    expect(result.content).toEqual([image, { type: "text", text: JSON.stringify({ ok: true }) }])
  })
})
