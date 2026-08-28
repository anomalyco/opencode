import { describe, expect, test } from "bun:test"
import { Message, Model } from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { toLLMMessages } from "@opencode-ai/core/session/runner/to-llm-message"
import { DateTime } from "effect"

const created = DateTime.makeUnsafe(0)
const id = (value: string) => SessionMessage.ID.make(`msg_${value}`)

describe("regression #38620 - errored message replay with Anthropic thinking + tool_use", () => {
  test("preserves thinking signature for errored same-model replay", () => {
    const anthroModel = Model.make({ id: "claude-3", provider: "anthropic", route: OpenAIChat.route })
    const msg = SessionMessage.Assistant.make({
      id: id("errored"),
      type: "assistant",
      agent: "build",
      model: { id: ModelV2.ID.make("claude-3"), providerID: ProviderV2.ID.make("anthropic") },
      content: [
        SessionMessage.AssistantReasoning.make({
          type: "reasoning",
          id: "r1",
          text: "Think step",
          providerMetadata: { anthropic: { signature: "sig_test" } },
        }),
        SessionMessage.AssistantTool.make({
          type: "tool",
          id: "tool1",
          name: "bash",
          state: SessionMessage.ToolStateCompleted.make({
            status: "completed",
            input: { command: "echo hi" },
            content: [{ type: "text", text: "hi" }],
            structured: {},
          }),
          time: { created },
          provider: { executed: false, metadata: { anthropic: { tool: "meta" } } },
        }),
      ],
      error: { type: "unknown", message: "Provider turn interrupted" },
      time: { created, completed: created },
    })
    const msgs = toLLMMessages([msg], anthroModel)
    // For completed tool with provider.executed false, expect 2 messages: assistant + tool
    expect(msgs.length).toBe(2)
    const assistantContent = msgs[0]?.content as any[]
    const toolContent = msgs[1]?.content as any[]
    const hasReasoning = assistantContent.some((c: any) => c.type === "reasoning" && c.providerMetadata?.anthropic?.signature === "sig_test")
    const hasToolCall = assistantContent.some((c: any) => c.type === "tool-call" && c.id === "tool1")
    expect(hasReasoning).toBe(true)
    expect(hasToolCall).toBe(true)
    // Invariant: never tool_use without preceding thinking when thinking enabled
    const reasoningIdx = assistantContent.findIndex((c: any) => c.type === "reasoning")
    const toolIdx = assistantContent.findIndex((c: any) => c.type === "tool-call")
    expect(reasoningIdx).toBeLessThan(toolIdx)
    expect(reasoningIdx).not.toBe(-1)
    // Also check tool result is present in second message
    expect(toolContent[0]?.type).toBe("tool-result")
  })

  test("still drops provider metadata for errored OpenAI (preserves existing test)", () => {
    const model = Model.make({ id: "model", provider: "provider", route: OpenAIChat.route })
    const msg = SessionMessage.Assistant.make({
      id: id("failed-openai"),
      type: "assistant",
      agent: "build",
      model: { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") },
      content: [
        SessionMessage.AssistantReasoning.make({
          type: "reasoning",
          id: "r-openai",
          text: "Partial thought",
          providerMetadata: { openai: { itemId: "rs_failed", reasoningEncryptedContent: null } },
        }),
        SessionMessage.AssistantTool.make({
          type: "tool",
          id: "tool-openai",
          name: "web_search",
          provider: {
            executed: true,
            metadata: { openai: { itemId: "call_failed" } },
            resultMetadata: { openai: { itemId: "result_failed" } },
          },
          state: SessionMessage.ToolStateError.make({
            status: "error",
            input: { query: "Effect" },
            error: { type: "unknown", message: "Provider turn interrupted" },
            content: [],
            structured: {},
          }),
          time: { created, completed: created },
        }),
      ],
      finish: "error",
      error: { type: "unknown", message: "Provider turn interrupted" },
      time: { created, completed: created },
    })
    const msgs = toLLMMessages([msg], model)
    // For OpenAI errored, should still drop providerMetadata (existing behavior)
    const content = msgs[0]?.content as any[]
    const reasoning = content.find((c: any) => c.type === "reasoning")
    expect(reasoning?.providerMetadata).toBeUndefined()
    const toolCall = content.find((c: any) => c.type === "tool-call" && c.id === "tool-openai")
    expect(toolCall?.providerMetadata).toBeUndefined()
  })

  test("different model drops metadata even for Anthropic thinking", () => {
    const anthroModel = Model.make({ id: "claude-3", provider: "anthropic", route: OpenAIChat.route })
    const differentModelMsg = SessionMessage.Assistant.make({
      id: id("diff-model"),
      type: "assistant",
      agent: "build",
      model: { id: ModelV2.ID.make("other-model"), providerID: ProviderV2.ID.make("anthropic") },
      content: [
        SessionMessage.AssistantReasoning.make({
          type: "reasoning",
          id: "r2",
          text: "Think",
          providerMetadata: { anthropic: { signature: "sig_old" } },
        }),
      ],
      time: { created, completed: created },
    })
    const msgs = toLLMMessages([differentModelMsg], anthroModel)
    const content = msgs[0]?.content as any[]
    // Different model should not reuse, so reasoning becomes text
    expect(content[0]?.type).toBe("text")
  })
})
