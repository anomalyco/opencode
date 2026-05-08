import { Schema } from "effect"
import { describe, expect, test } from "bun:test"
import { ConfigMCP } from "@/config/mcp"

describe("MCP local config env alias", () => {
  test("accepts 'env' field for environment variables", () => {
    const input = {
      type: "local" as const,
      command: ["npx", "-y", "@notionhq/notion-mcp-server"],
      env: { NOTION_TOKEN: "ntn_test" },
    }
    const result = Schema.decodeUnknownSync(ConfigMCP.Local)(input)
    expect(result.env).toEqual({ NOTION_TOKEN: "ntn_test" })
  })

  test("accepts 'environment' field for backward compatibility", () => {
    const input = {
      type: "local" as const,
      command: ["npx", "-y", "@notionhq/notion-mcp-server"],
      environment: { NOTION_TOKEN: "ntn_test" },
    }
    const result = Schema.decodeUnknownSync(ConfigMCP.Local)(input)
    expect(result.environment).toEqual({ NOTION_TOKEN: "ntn_test" })
  })

  test("accepts both 'env' and 'environment' together", () => {
    const input = {
      type: "local" as const,
      command: ["npx", "-y", "test-server"],
      env: { A: "1" },
      environment: { B: "2" },
    }
    const result = Schema.decodeUnknownSync(ConfigMCP.Local)(input)
    expect(result.env).toEqual({ A: "1" })
    expect(result.environment).toEqual({ B: "2" })
  })
})
