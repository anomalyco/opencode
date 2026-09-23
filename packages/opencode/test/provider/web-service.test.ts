import { describe, expect, test } from "bun:test"
import type { LanguageModelV3CallOptions, LanguageModelV3FunctionTool } from "@ai-sdk/provider"
import { WebService } from "@/provider/web-service"

const readTool: LanguageModelV3FunctionTool = {
  type: "function",
  name: "read",
  description: "Read a local file",
  inputSchema: {
    type: "object",
    properties: { filePath: { type: "string" } },
    required: ["filePath"],
    additionalProperties: false,
  },
}

const globTool: LanguageModelV3FunctionTool = {
  type: "function",
  name: "glob",
  description: "Find files by pattern",
  inputSchema: {
    type: "object",
    properties: { pattern: { type: "string" } },
    required: ["pattern"],
    additionalProperties: false,
  },
}

describe("provider.web-service", () => {
  test("advertises tool support and optional DeepSeek thinking", () => {
    const providers = WebService.providers()
    const chatgpt = providers.find((item) => item.id === "chatgpt-web")?.models.current
    const deepseek = providers.find((item) => item.id === "deepseek-web")?.models.default

    expect(chatgpt?.capabilities.toolcall).toBe(true)
    expect(chatgpt?.variants).toEqual({})
    expect(deepseek?.capabilities.toolcall).toBe(true)
    expect(deepseek?.variants).toEqual({ thinking: { thinking_enabled: true } })
  })

  test("recognizes only the permitted local tool names", () => {
    expect(WebService.isLocalTool("read")).toBe(true)
    expect(WebService.isLocalTool("bash")).toBe(true)
    expect(WebService.isLocalTool("task")).toBe(false)
    expect(WebService.isLocalTool("mcp_search")).toBe(false)
  })

  test("parses one available tool call", () => {
    expect(
      WebService.parseWebReply(
        '<opencode_tool_call>{"name":"read","arguments":{"filePath":"src/app.ts"}}</opencode_tool_call>',
        [readTool],
      ),
    ).toEqual({
      type: "tool-calls",
      text: "",
      calls: [{ toolName: "read", input: { filePath: "src/app.ts" } }],
    })
  })

  test("repairs tool names with the wrong casing", () => {
    expect(
      WebService.parseWebReply(
        '<opencode_tool_call>{"name":"READ","arguments":{"filePath":"src/app.ts"}}</opencode_tool_call>',
        [readTool],
      ),
    ).toMatchObject({
      type: "tool-calls",
      calls: [{ toolName: "read", input: { filePath: "src/app.ts" } }],
    })
  })

  test("returns ordinary text without a tool marker", () => {
    expect(WebService.parseWebReply("The file is ready.", [readTool])).toEqual({
      type: "text",
      text: "The file is ready.",
    })
  })

  test("preserves prose and parses multiple tool calls", () => {
    expect(
      WebService.parseWebReply(
        'I will inspect the project.\n<opencode_tool_call>{"name":"read","arguments":{"filePath":"src/app.ts"}}</opencode_tool_call>\n<opencode_tool_call>{"name":"glob","arguments":{"pattern":"*.ts"}}</opencode_tool_call>',
        [readTool, globTool],
      ),
    ).toEqual({
      type: "tool-calls",
      text: "I will inspect the project.\n\n",
      calls: [
        { toolName: "read", input: { filePath: "src/app.ts" } },
        { toolName: "glob", input: { pattern: "*.ts" } },
      ],
    })
  })

  test("routes the screenshot's invalid Windows path to the invalid tool and keeps the valid glob call", () => {
    const reply = [
      "I'll look at the project structure and key files to understand it.",
      String.raw`<opencode_tool_call>{"name":"read","arguments":{"filePath":"G:\chen\Study\chat-api"}}</opencode_tool_call>`,
      '<opencode_tool_call>{"name":"glob","arguments":{"pattern":"*.{md,json,toml,yaml,yml,txt}"}}</opencode_tool_call>',
    ].join("\n")

    const result = WebService.parseWebReply(reply, [readTool, globTool])
    expect(result.type).toBe("tool-calls")
    if (result.type !== "tool-calls") return
    expect(result.text).toContain("I'll look at the project structure")
    expect(result.calls[0]).toMatchObject({
      toolName: "invalid",
      input: { tool: "unknown", error: expect.stringContaining("valid JSON") },
    })
    expect(result.calls[1]).toEqual({
      toolName: "glob",
      input: { pattern: "*.{md,json,toml,yaml,yml,txt}" },
    })
  })

  test.each([
    ["missing close marker", '<opencode_tool_call>{"name":"read"}'],
    ["orphan close marker", "</opencode_tool_call>"],
    ["nested start marker", "<opencode_tool_call><opencode_tool_call>{}</opencode_tool_call>"],
    [
      "unmatched close after a valid call",
      '<opencode_tool_call>{"name":"read","arguments":{"filePath":"a"}}</opencode_tool_call></opencode_tool_call>',
    ],
  ])("rejects all calls when markers are malformed: %s", (_name, text) => {
    expect(() => WebService.parseWebReply(text, [readTool])).toThrow("不完整")
  })

  test.each([
    ["invalid JSON", '<opencode_tool_call>{"name":"read","arguments":}</opencode_tool_call>', "valid JSON"],
    [
      "invalid envelope fields",
      '<opencode_tool_call>{"name":"read","arguments":{},"extra":true}</opencode_tool_call>',
      "exactly a tool name",
    ],
    [
      "arguments are not an object",
      '<opencode_tool_call>{"name":"read","arguments":[]}</opencode_tool_call>',
      "object of arguments",
    ],
  ])("maps %s to the invalid tool", (_name, text, error) => {
    expect(WebService.parseWebReply(text, [readTool])).toMatchObject({
      type: "tool-calls",
      calls: [{ toolName: "invalid", input: { error: expect.stringContaining(error) } }],
    })
  })

  test("maps unavailable tools to the invalid tool", () => {
    expect(
      WebService.parseWebReply('<opencode_tool_call>{"name":"task","arguments":{}}</opencode_tool_call>', [readTool]),
    ).toMatchObject({
      type: "tool-calls",
      calls: [{ toolName: "invalid", input: { tool: "task", error: expect.stringContaining("not available") } }],
    })
  })

  test("builds incremental tool-result prompts and a full recovery transcript", () => {
    const options = {
      prompt: [
        { role: "system", content: "Use the OpenCode workspace." },
        { role: "user", content: [{ type: "text", text: "Read src/app.ts" }] },
        {
          role: "assistant",
          content: [{ type: "tool-call", toolCallId: "call-1", toolName: "read", input: { filePath: "src/app.ts" } }],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call-1",
              toolName: "read",
              output: { type: "text", value: "export const app = 1" },
            },
          ],
        },
      ],
    } satisfies Pick<LanguageModelV3CallOptions, "prompt" | "toolChoice">
    const prompts = WebService.buildRequestPrompts(options, [readTool])

    expect(prompts.prompt).toContain("export const app = 1")
    expect(prompts.prompt).not.toContain("Read src/app.ts")
    expect(prompts.prompt).toContain('"name":"read"')
    expect(prompts.prompt).toContain("multiple envelopes")
    expect(prompts.prompt).toContain("escape each backslash")
    expect(prompts.prompt).toContain("uses \\\\ between folders")
    expect(prompts.fullPrompt).toContain("Use the OpenCode workspace.")
    expect(prompts.fullPrompt).toContain("Read src/app.ts")
  })

  test("sends invalid tool results back to the web model in the next prompt", () => {
    const prompts = WebService.buildRequestPrompts(
      {
        prompt: [
          { role: "user", content: [{ type: "text", text: "Read this file" }] },
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call-1",
                toolName: "invalid",
                input: { tool: "read", error: "Invalid JSON" },
              },
            ],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "call-1",
                toolName: "invalid",
                output: { type: "text", value: "The arguments provided to the tool are invalid: Invalid JSON" },
              },
            ],
          },
        ],
      },
      [readTool],
    )

    expect(prompts.prompt).toContain("The arguments provided to the tool are invalid: Invalid JSON")
  })

  test("rejects local attachments in the current user turn", () => {
    const options = {
      prompt: [{ role: "user", content: [{ type: "file", mediaType: "text/plain", data: "c2VjcmV0" }] }],
    } satisfies Pick<LanguageModelV3CallOptions, "prompt" | "toolChoice">

    expect(() => WebService.buildRequestPrompts(options, [])).toThrow("不支持本地附件")
  })
})
