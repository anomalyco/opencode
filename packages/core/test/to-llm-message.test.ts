import { describe, expect, test } from "bun:test"
import { Agent } from "@opencode-ai/core/agent"
import { Model } from "@opencode-ai/core/model"
import { Provider } from "@opencode-ai/core/provider"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { toLLMMessages } from "@opencode-ai/core/session/runner/to-llm-message"
import { Schema } from "effect"

const model = { id: Model.ID.make("test-model"), providerID: Provider.ID.make("test-provider") }

const reasoning = (text: string, state: Record<string, unknown> | undefined) => ({
  type: "reasoning",
  text,
  ...(state === undefined ? {} : { state }),
  time: { created: 0, completed: 0 },
})

const streamingTool = {
  type: "tool",
  id: "tool_1",
  name: "read",
  executed: false,
  state: { status: "streaming", input: '{"path":"a.ts"}' },
  time: { created: 0 },
}

const runningTool = {
  type: "tool",
  id: "tool_2",
  name: "write",
  executed: false,
  state: { status: "running", input: {}, metadata: {} },
  time: { created: 0 },
}

const completedTool = {
  type: "tool",
  id: "tool_3",
  name: "read",
  executed: true,
  state: { status: "completed", input: {}, content: [{ type: "text", text: "ok" }] },
  time: { created: 0, completed: 0 },
}

const assistant = (content: unknown[], error: unknown = undefined) =>
  Schema.decodeUnknownSync(SessionMessage.Assistant)({
    id: SessionMessage.ID.make("msg_assistant"),
    type: "assistant",
    agent: Agent.defaultID,
    model,
    content,
    ...(error === undefined ? {} : { error }),
    time: { created: 0, completed: 0 },
  })

const contents = (message: { content: readonly unknown[] }) => message.content

describe("toLLMMessages errored assistant messages", () => {
  test("replays signed thinking with an unsettled tool call dropped", () => {
    const messages = toLLMMessages(
      [assistant([reasoning("thinking text", { signature: "sig-1" }), streamingTool], { type: "aborted", message: "Step interrupted" })],
      model,
    )

    expect(messages.map(contents)).toEqual([
      [{ type: "reasoning", text: "thinking text", providerMetadata: { "test-provider": { signature: "sig-1" } } }],
    ])
  })

  test("replays redacted thinking without a downgrade", () => {
    const messages = toLLMMessages(
      [assistant([reasoning("", { redactedData: "redacted-payload" }), streamingTool], { type: "aborted", message: "Step interrupted" })],
      model,
    )

    expect(messages.map(contents)).toEqual([
      [{ type: "reasoning", text: "", providerMetadata: { "test-provider": { redactedData: "redacted-payload" } } }],
    ])
  })

  test("downgrades unsigned thinking to text and drops the unsettled tool call", () => {
    const messages = toLLMMessages(
      [assistant([reasoning("partial thinking", undefined), streamingTool], { type: "aborted", message: "Step interrupted" })],
      model,
    )

    expect(messages.map(contents)).toEqual([[{ type: "text", text: "partial thinking" }]])
  })

  test("keeps an executed completed tool call and its result", () => {
    const messages = toLLMMessages(
      [assistant([reasoning("thinking text", { signature: "sig-1" }), completedTool], { type: "aborted", message: "Step interrupted" })],
      model,
    )

    expect(messages.map(contents)).toEqual([
      [
        { type: "reasoning", text: "thinking text", providerMetadata: { "test-provider": { signature: "sig-1" } } },
        { type: "tool-call", id: "tool_3", name: "read", input: {}, providerExecuted: true },
        {
          type: "tool-result",
          id: "tool_3",
          name: "read",
          result: { type: "text", value: "ok" },
          providerExecuted: true,
        },
      ],
    ])
  })

  test("drops an executed but unsettled tool call", () => {
    const messages = toLLMMessages(
      [assistant([reasoning("partial thinking", undefined), runningTool], { type: "aborted", message: "Step interrupted" })],
      model,
    )

    expect(messages.map(contents)).toEqual([[{ type: "text", text: "partial thinking" }]])
  })

  test("downgrades thinking and drops the tool call after a model switch", () => {
    const switched = { id: Model.ID.make("other-model"), providerID: Provider.ID.make("test-provider") }
    const messages = toLLMMessages(
      [assistant([reasoning("thinking text", { signature: "sig-1" }), streamingTool], { type: "aborted", message: "Step interrupted" })],
      switched,
    )

    expect(messages.map(contents)).toEqual([[{ type: "text", text: "thinking text" }]])
  })

  test("replays signed thinking and an unsettled tool call from a completed message", () => {
    const messages = toLLMMessages([assistant([reasoning("thinking text", { signature: "sig-1" }), streamingTool])], model)

    expect(messages.map(contents)).toEqual([
      [
        { type: "reasoning", text: "thinking text", providerMetadata: { "test-provider": { signature: "sig-1" } } },
        { type: "tool-call", id: "tool_1", name: "read", input: { path: "a.ts" }, providerExecuted: false },
      ],
    ])
  })
})
