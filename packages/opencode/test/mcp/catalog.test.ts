import { describe, expect, test } from "bun:test"
import { McpCatalog } from "../../src/mcp/catalog"

describe("McpCatalog.convertTool", () => {
  test("preserves image content when structuredContent is present", async () => {
    const client = {
      callTool: async () => ({
        content: [
          {
            type: "image" as const,
            data: "iVBORw0KGgo=",
            mimeType: "image/png",
          },
        ],
        structuredContent: { ok: true },
        isError: false,
      }),
    }

    const tool = McpCatalog.convertTool(
      {
        name: "image_only_result",
        description: "returns an image",
        inputSchema: { type: "object", properties: {} },
      },
      client as any,
    )

    const result = await (tool as any).execute({}, { abortSignal: new AbortController().signal })

    expect(result.content).toEqual([
      {
        type: "image",
        data: "iVBORw0KGgo=",
        mimeType: "image/png",
      },
      {
        type: "text",
        text: JSON.stringify({ ok: true }),
      },
    ])
  })
})
