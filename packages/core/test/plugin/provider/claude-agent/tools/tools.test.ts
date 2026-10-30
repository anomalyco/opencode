import { describe, expect, test } from "bun:test"
import type { LanguageModelV3FunctionTool, LanguageModelV3Prompt } from "@ai-sdk/provider"
import { ToolNames } from "@opencode/core/plugin/provider/claude-agent/tools/names"
import { ToolResult } from "@opencode/core/plugin/provider/claude-agent/tools/result"

describe("tool bridge conversion", () => {
  test("names round-trip within Claude's limit, including names that need sanitizing", () => {
    const tools = ["read", "resource_".repeat(15), "resource_".repeat(15) + "b", "mcp.example/search"].map(
      (name): LanguageModelV3FunctionTool => ({ type: "function", name, inputSchema: { type: "object" } }),
    )
    const names = new Set<string>()
    for (const tool of tools) {
      const name = ToolNames.PREFIX + ToolNames.short(tool.name)
      expect(name.length).toBeLessThanOrEqual(64)
      expect(name).toMatch(/^[a-zA-Z0-9_-]+$/)
      expect(ToolNames.original(name, tools)).toBe(tool.name)
      names.add(name)
    }
    expect(names.size).toBe(tools.length)
    expect(ToolNames.original("Bash", tools)).toBeUndefined()
  })

  test("long subagent descriptions retain the actual OpenCode agent list", () => {
    const description = ToolNames.description({
      type: "function",
      name: "subagent",
      inputSchema: {},
      description:
        "Long instructions. ".repeat(200) +
        "\n\nAvailable subagents:\n- explore: Explore the repository.\n- general: General tasks.",
    })
    expect(description.length).toBeLessThanOrEqual(2048)
    expect(description).toStartWith("Available subagents:")
    expect(description).toContain("- general:")
  })

  test("execution failures and denied permissions stay errors, and JSON stays intact", () => {
    expect(ToolResult.convert({ type: "json", value: { items: [1, { enabled: true }] } }).mcp).toEqual({
      content: [{ type: "text", text: '{"items":[1,{"enabled":true}]}' }],
      isError: false,
    })
    for (const output of [
      { type: "error-text", value: "failed" },
      { type: "error-json", value: { error: "failed" } },
      { type: "execution-denied", reason: "denied" },
    ] as const) {
      expect(ToolResult.convert(output).mcp.isError).toBe(true)
    }
  })

  test("tool media remains content blocks and does not consume a newly queued user message", () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: "tool",
        content: [
          { type: "tool-result", toolCallId: "a", toolName: "read", output: { type: "text", value: "first" } },
          { type: "tool-result", toolCallId: "b", toolName: "read", output: { type: "text", value: "second" } },
        ],
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Attached media from tool result:" },
          { type: "file", mediaType: "image/png", data: "aW1hZ2U=" },
          { type: "file", mediaType: "application/pdf", data: "cGRm" },
        ],
      },
      { role: "user", content: [{ type: "text", text: "New instructions" }] },
    ]
    const result = ToolResult.collect(prompt, 0)
    expect(result.end).toBe(2)
    expect(result.results.get("a")!.mcp.content).toEqual([{ type: "text", text: "first" }])
    expect(result.results.get("b")!.replacement).toEqual([
      { type: "text", text: "second" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "aW1hZ2U=" } },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "cGRm" } },
    ])
    const image = ToolResult.convert({
      type: "content",
      value: [{ type: "image-data", mediaType: "image/png", data: "aW1hZ2U=" }],
    })
    expect(image.mcp.content).toEqual([{ type: "image", mimeType: "image/png", data: "aW1hZ2U=" }])
    expect(image.replacement).toBeUndefined()
  })
})
