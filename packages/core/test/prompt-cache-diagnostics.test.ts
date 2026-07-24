import { describe, expect, test } from "bun:test"
import { GenerationOptions, LLM, LLMRequest, Message, Model, ToolDefinition } from "@opencode-ai/ai"
import { OpenAIChat } from "@opencode-ai/ai/protocols"
import { PromptCacheDiagnostics } from "@opencode-ai/core/session/prompt-cache-diagnostics"

const model = Model.make({ id: "test", provider: "test", route: OpenAIChat.route })
const tool = ToolDefinition.make({
  name: "read",
  description: "Read a file",
  inputSchema: { type: "object", properties: {} },
})

const request = LLM.request({
  model,
  system: "System",
  prompt: "First",
  tools: [tool],
})

describe("PromptCacheDiagnostics", () => {
  test("distinguishes initial and stable requests", () => {
    const snapshot = PromptCacheDiagnostics.snapshot(request)
    expect(PromptCacheDiagnostics.compare(undefined, snapshot)).toEqual({ status: "initial" })
    expect(PromptCacheDiagnostics.compare(snapshot, snapshot)).toEqual({ status: "stable", messages: 1 })
  })

  test("recognizes append-only history", () => {
    const current = LLMRequest.update(request, { messages: [...request.messages, Message.assistant("Second")] })
    expect(
      PromptCacheDiagnostics.compare(
        PromptCacheDiagnostics.snapshot(request),
        PromptCacheDiagnostics.snapshot(current),
      ),
    ).toEqual({ status: "append-only", previousMessages: 1, currentMessages: 2 })
  })

  test("detects cache-sensitive setting changes", () => {
    const current = LLMRequest.update(request, { generation: GenerationOptions.make({ temperature: 0.5 }) })
    expect(
      PromptCacheDiagnostics.compare(
        PromptCacheDiagnostics.snapshot(request),
        PromptCacheDiagnostics.snapshot(current),
      ),
    ).toEqual({ status: "changed", component: "settings", index: 0, label: "model settings" })
  })

  test("finds the first changed prefix component", () => {
    const changedTool = ToolDefinition.make({ ...tool, description: "Read one file" })
    const current = LLMRequest.update(request, { tools: [changedTool] })
    expect(
      PromptCacheDiagnostics.compare(
        PromptCacheDiagnostics.snapshot(request),
        PromptCacheDiagnostics.snapshot(current),
      ),
    ).toMatchObject({ status: "changed", component: "tools", index: 0, label: "read" })
  })

  test("treats appended tools as a prefix change", () => {
    const write = ToolDefinition.make({
      name: "write",
      description: "Write a file",
      inputSchema: { type: "object", properties: {} },
    })
    const current = LLMRequest.update(request, { tools: [...request.tools, write] })
    expect(
      PromptCacheDiagnostics.compare(
        PromptCacheDiagnostics.snapshot(request),
        PromptCacheDiagnostics.snapshot(current),
      ),
    ).toMatchObject({ status: "changed", component: "tools", index: 1, label: "write" })
  })
})
