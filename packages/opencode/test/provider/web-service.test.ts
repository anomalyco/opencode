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

  test("parses exactly one available tool call", () => {
    expect(
      WebService.parseWebReply(
        '<opencode_tool_call>{"name":"read","arguments":{"filePath":"src/app.ts"}}</opencode_tool_call>',
        [readTool],
      ),
    ).toEqual({ type: "tool-call", tool: readTool, input: { filePath: "src/app.ts" } })
  })

  test("returns ordinary text without a tool marker", () => {
    expect(WebService.parseWebReply("The file is ready.", [readTool])).toEqual({
      type: "text",
      text: "The file is ready.",
    })
  })

  test.each([
    ["partial marker", '<opencode_tool_call>{"name":"read"}'],
    ["malformed JSON", '<opencode_tool_call>{"name":"read","arguments":}</opencode_tool_call>'],
    ["extra keys", '<opencode_tool_call>{"name":"read","arguments":{},"extra":true}</opencode_tool_call>'],
    ["prose outside envelope", 'I will read it. <opencode_tool_call>{"name":"read","arguments":{}}</opencode_tool_call>'],
  ])("rejects %s without producing a tool call", (_name, text) => {
    expect(() => WebService.parseWebReply(text, [readTool])).toThrow()
  })

  test("rejects unavailable tools", () => {
    expect(() =>
      WebService.parseWebReply(
        '<opencode_tool_call>{"name":"task","arguments":{}}</opencode_tool_call>',
        [readTool],
      ),
    ).toThrow("本轮不可用")
  })

  test("builds incremental tool-result prompts and a full recovery transcript", () => {
    const options = {
      prompt: [
        { role: "system", content: "Use the OpenCode workspace." },
        { role: "user", content: [{ type: "text", text: "Read src/app.ts" }] },
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolCallId: "call-1", toolName: "read", input: { filePath: "src/app.ts" } },
          ],
        },
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "call-1", toolName: "read", output: { type: "text", value: "export const app = 1" } }],
        },
      ],
    } satisfies Pick<LanguageModelV3CallOptions, "prompt" | "toolChoice">
    const prompts = WebService.buildRequestPrompts(options, [readTool])

    expect(prompts.prompt).toContain("export const app = 1")
    expect(prompts.prompt).not.toContain("Read src/app.ts")
    expect(prompts.prompt).toContain('"name":"read"')
    expect(prompts.fullPrompt).toContain("Use the OpenCode workspace.")
    expect(prompts.fullPrompt).toContain("Read src/app.ts")
  })

  test("rejects local attachments in the current user turn", () => {
    const options = {
      prompt: [{ role: "user", content: [{ type: "file", mediaType: "text/plain", data: "c2VjcmV0" }] }],
    } satisfies Pick<LanguageModelV3CallOptions, "prompt" | "toolChoice">

    expect(() => WebService.buildRequestPrompts(options, [])).toThrow("不支持本地附件")
  })
})
