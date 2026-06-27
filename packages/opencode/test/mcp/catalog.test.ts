import { describe, expect, test } from "bun:test"
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import type { Schema } from "ai"
import { convertTool } from "../../src/mcp/catalog"

const mockClient = {} as any

function makeMCPTool(inputSchema: Record<string, unknown>): MCPToolDef {
  return {
    name: "test_tool",
    inputSchema: inputSchema as MCPToolDef["inputSchema"],
  }
}

function getJsonSchema(tool: ReturnType<typeof convertTool>): Record<string, unknown> {
  return (tool.inputSchema as Schema<unknown>).jsonSchema as Record<string, unknown>
}

describe("convertTool additionalProperties", () => {
  test("defaults to false when server omits additionalProperties", () => {
    const mcpTool = makeMCPTool({
      type: "object",
      properties: { name: { type: "string" } },
    })

    const tool = convertTool(mcpTool, mockClient)
    const schema = getJsonSchema(tool)

    expect(schema.additionalProperties).toBe(false)
  })

  test("preserves additionalProperties: true from server schema", () => {
    const mcpTool = makeMCPTool({
      type: "object",
      properties: { name: { type: "string" } },
      additionalProperties: true,
    })

    const tool = convertTool(mcpTool, mockClient)
    const schema = getJsonSchema(tool)

    expect(schema.additionalProperties).toBe(true)
  })

  test("preserves additionalProperties object sub-schema from server", () => {
    const subSchema = { type: "string" as const }
    const mcpTool = makeMCPTool({
      type: "object",
      properties: { name: { type: "string" } },
      additionalProperties: subSchema,
    })

    const tool = convertTool(mcpTool, mockClient)
    const schema = getJsonSchema(tool)

    expect(schema.additionalProperties).toEqual(subSchema)
  })

  test("preserves explicit additionalProperties: false from server", () => {
    const mcpTool = makeMCPTool({
      type: "object",
      properties: { name: { type: "string" } },
      additionalProperties: false,
    })

    const tool = convertTool(mcpTool, mockClient)
    const schema = getJsonSchema(tool)

    expect(schema.additionalProperties).toBe(false)
  })
})
