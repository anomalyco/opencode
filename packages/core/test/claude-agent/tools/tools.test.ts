import { describe, expect, test } from "bun:test"
import type { LanguageModelV3FunctionTool, LanguageModelV3Prompt } from "@ai-sdk/provider"
import { ToolNames } from "@opencode/core/claude-agent/tools/names"
import { ToolResult } from "@opencode/core/claude-agent/tools/result"
import { ClaudeSystemPrompt } from "@opencode/core/claude-agent/language-model/system-prompt"

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
    expect(() => ToolNames.original("Bash", tools)).toThrow("unregistered")
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

  test("the preset receives tool context, explicit roles and complete instruction files", () => {
    const catalog =
      "# Code Mode\n\nUse execute and search.\n\n## Available tools\n\n- accounts (1 tool) // Customer account tools.\nUse the account ID from search.\n  - tools.accounts.search(): Promise<unknown>\n- example (1 tool)\n  - tools.example.read({\n      path: string,\n    }): Promise<string>\n"
    const mcp = '<mcp_instructions>\n  <server name="example">Use its documented paths.</server>\n</mcp_instructions>'
    const skills =
      "Skills provide specialized instructions and workflows for specific tasks.\n<available_skills><skill>fixture</skill></available_skills>"
    const instructions =
      "Instructions from: AGENTS.md\nPROJECT-RULE\n\n## Style\nKeep it readable.\n\nInstructions from: https://example.com/guide.md\nCONFIGURED-RULE"
    const system = ClaudeSystemPrompt.make(
      [
        {
          role: "system",
          content: [
            "GENERIC-OPENCode-PROMPT",
            catalog,
            mcp,
            skills,
            instructions,
            "Today's date: Sat Oct 17 2026\n\n<env>OPENCode-ENVIRONMENT</env>",
          ].join("\n\n"),
        },
      ],
      true,
      "CUSTOM-ROLE",
    )
    expect(system.preset).toBe("claude_code")
    expect(system.snapshot).toBe(false)
    expect(system.append).toContain(catalog.trim())
    expect(system.append).toContain(mcp)
    expect(system.append).toContain(skills)
    expect(system.append).not.toContain("GENERIC-OPENCode-PROMPT")
    expect(system.append).toContain("CUSTOM-ROLE")
    expect(system.append).toContain(instructions)
    expect(system.append).not.toContain("OPENCode-ENVIRONMENT")
  })
})
