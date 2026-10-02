import { describe, expect, test } from "bun:test"
import { LLM, Message, Model } from "@opencode-ai/llm"
import * as OpenAIChat from "@opencode-ai/llm/protocols/openai-chat"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { toLLMMessages } from "@opencode-ai/core/session/runner/to-llm-message"
import { DateTime, Schema } from "effect"

const created = DateTime.makeUnsafe(0)
const id = (value: string) => SessionMessage.ID.make(`msg_${value}`)
const model = Model.make({ id: "model", provider: "provider", route: OpenAIChat.route })
const otherModel = Model.make({ id: "other", provider: "other-provider", route: OpenAIChat.route })

const assistantWith = (value: string, content: SessionMessage.Assistant["content"], extra?: Partial<SessionMessage.Assistant>) =>
  SessionMessage.Assistant.make({
    id: id(value),
    type: "assistant",
    agent: "build",
    model: { id: ModelV2.ID.make("model"), providerID: ProviderV2.ID.make("provider") },
    content,
    time: { created, completed: created },
    ...extra,
  })

describe("transport-poisoned tool sanitization", () => {
  test("incomplete tool calls produce paired error results instead of dangling calls", () => {
    const messages = toLLMMessages(
      [
        assistantWith(
          "interrupted",
          [
            SessionMessage.AssistantTool.make({
              type: "tool",
              id: "call-empty-input",
              name: "shell",
              time: { created },
              state: SessionMessage.ToolStatePending.make({ status: "pending", input: "" }),
            }),
            SessionMessage.AssistantTool.make({
              type: "tool",
              id: "call-partial-input",
              name: "shell",
              time: { created },
              state: SessionMessage.ToolStatePending.make({ status: "pending", input: "Partial" }),
            }),
            SessionMessage.AssistantTool.make({
              type: "tool",
              id: "call-malformed-json",
              name: "shell",
              time: { created },
              state: SessionMessage.ToolStatePending.make({ status: "pending", input: '{"command":' }),
            }),
            SessionMessage.AssistantTool.make({
              type: "tool",
              id: "call-running-empty",
              name: "shell",
              time: { created },
              state: SessionMessage.ToolStateRunning.make({
                status: "running",
                input: {},
                content: [],
                structured: {},
              }),
            }),
          ],
          { finish: "error", error: { type: "unknown", message: "Decode error (200 POST https://proxy/v1/chat/completions)" } },
        ),
      ],
      model,
    )

    // Every tool-call must have a paired tool-result; otherwise the next
    // provider request is rejected and the session bricks permanently.
    const calls = messages.flatMap((message) =>
      message.content.filter((part) => part.type === "tool-call"),
    )
    const results = messages.flatMap((message) =>
      message.content.filter((part) => part.type === "tool-result"),
    )
    expect(calls.map((part) => (part.type === "tool-call" ? part.id : "")).toSorted()).toEqual(
      ["call-empty-input", "call-malformed-json", "call-partial-input", "call-running-empty"].toSorted(),
    )
    expect(results.map((part) => (part.type === "tool-result" ? part.id : "")).toSorted()).toEqual(
      ["call-empty-input", "call-malformed-json", "call-partial-input", "call-running-empty"].toSorted(),
    )
    for (const result of results) {
      expect(result.type).toBe("tool-result")
      if (result.type !== "tool-result") continue
      expect(result.result.type).toBe("error")
    }

    // Must build a valid LLMRequest without Schema validation failure,
    // even after switching models (validation runs before provider selection).
    for (const current of [model, otherModel]) {
      const request = LLM.request({ model: current, messages })
      expect(request.messages).toHaveLength(messages.length)
    }
  })

  test("error tool with empty input and local execution drains without validation failure", () => {
    const messages = toLLMMessages(
      [
        assistantWith(
          "transport-error",
          [
            SessionMessage.AssistantTool.make({
              type: "tool",
              id: "chatcmpl-tool-interrupted",
              name: "shell",
              provider: { executed: false },
              time: { created, completed: created },
              state: SessionMessage.ToolStateError.make({
                status: "error",
                input: {},
                content: [],
                structured: {},
                error: {
                  type: "unknown",
                  message: "Decode error (200 POST https://proxy/v1/chat/completions)",
                },
              }),
            }),
          ],
          { finish: "error", error: { type: "unknown", message: "Decode error (200 POST https://proxy/v1/chat/completions)" } },
        ),
      ],
      model,
    )

    const calls = messages.flatMap((message) =>
      message.content.filter((part) => part.type === "tool-call"),
    )
    const results = messages.flatMap((message) =>
      message.content.filter((part) => part.type === "tool-result"),
    )
    expect(calls).toHaveLength(1)
    expect(results).toHaveLength(1)
    expect(calls[0]).toMatchObject({ type: "tool-call", id: "chatcmpl-tool-interrupted", name: "shell", input: {} })
    expect(results[0]?.type).toBe("tool-result")
    if (results[0]?.type !== "tool-result") throw new Error("expected tool-result")
    expect(results[0].result.type).toBe("error")

    // Schema-decode every produced message to prove no validation failure.
    const decode = Schema.decodeUnknownSync(Message)
    for (const message of messages) decode({ ...message, content: [...message.content] })

    for (const current of [model, otherModel]) {
      const request = LLM.request({ model: current, messages })
      expect(request.messages.length).toBeGreaterThan(0)
    }
  })

  test("aborted and unknown error tools remain valid alongside interrupted pendings", () => {
    const messages = toLLMMessages(
      [
        assistantWith("mixed", [
          SessionMessage.AssistantTool.make({
            type: "tool",
            id: "call-aborted",
            name: "shell",
            time: { created, completed: created },
            state: SessionMessage.ToolStateError.make({
              status: "error",
              input: { command: "sleep 10" },
              content: [],
              structured: {},
              error: { type: "unknown", message: "Tool execution aborted" },
            }),
          }),
          SessionMessage.AssistantTool.make({
            type: "tool",
            id: "call-unknown",
            name: "shell",
            time: { created, completed: created },
            state: SessionMessage.ToolStateError.make({
              status: "error",
              input: {},
              content: [{ type: "text", text: "partial output" }],
              structured: {},
              error: { type: "unknown", message: "Tool execution failed" },
            }),
          }),
          SessionMessage.AssistantTool.make({
            type: "tool",
            id: "call-pending-after-abort",
            name: "shell",
            time: { created },
            state: SessionMessage.ToolStatePending.make({ status: "pending", input: "" }),
          }),
        ]),
      ],
      model,
    )

    const calls = messages.flatMap((message) =>
      message.content.filter((part) => part.type === "tool-call"),
    )
    const results = messages.flatMap((message) =>
      message.content.filter((part) => part.type === "tool-result"),
    )
    expect(calls).toHaveLength(3)
    expect(results).toHaveLength(3)

    const request = LLM.request({ model, messages })
    expect(request.messages.length).toBeGreaterThan(0)
  })
})
