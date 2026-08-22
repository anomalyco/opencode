import { expect, test } from "bun:test"
import { LLM } from "@opencode-ai/ai"
import { configure } from "@opencode-ai/ai/providers/anthropic"
import { compileRequest } from "@opencode-ai/ai/route/client"
import { Agent } from "@opencode-ai/core/agent"
import { Model } from "@opencode-ai/core/model"
import { Provider } from "@opencode-ai/core/provider"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { toLLMMessages } from "@opencode-ai/core/session/runner/to-llm-message"
import { DateTime, Effect } from "effect"

const created = DateTime.makeUnsafe(0)
const anthropic = Model.Ref.make({
  id: Model.ID.make("claude-sonnet-4-6"),
  providerID: Provider.ID.make("anthropic"),
})
const continuation =
  "The previous response was interrupted. Continue from where you left off without repeating completed content."

test("failed Anthropic tool history replays through the public request boundary", async () => {
  const messages = toLLMMessages(
    [
      SessionMessage.User.make({
        id: SessionMessage.ID.make("msg_user"),
        type: "user",
        text: "Look up the weather.",
        time: { created },
      }),
      SessionMessage.Assistant.make({
        id: SessionMessage.ID.make("msg_failed"),
        type: "assistant",
        agent: Agent.defaultID,
        model: anthropic,
        content: [
          SessionMessage.AssistantReasoning.make({
            type: "reasoning",
            text: "I should use the weather tool.",
            state: { signature: "signed-reasoning" },
          }),
          SessionMessage.AssistantTool.make({
            type: "tool",
            id: "call_weather",
            name: "lookup_weather",
            executed: false,
            state: SessionMessage.ToolStateCompleted.make({
              status: "completed",
              input: { city: "Paris" },
              content: [{ type: "text", text: "sunny" }],
            }),
            time: { created, completed: created },
          }),
        ],
        finish: "error",
        error: { type: "provider.internal", message: "Provider stream failed" },
        time: { created, completed: created },
      }),
      SessionMessage.Synthetic.make({
        id: SessionMessage.ID.make("msg_continue"),
        type: "synthetic",
        text: continuation,
        time: { created },
      }),
    ],
    anthropic,
  )
  const prepared = await Effect.runPromise(
    compileRequest(
      LLM.request({
        model: configure({ apiKey: "test" }).model("claude-sonnet-4-6"),
        messages,
      }),
    ),
  )

  expect(messages).toMatchObject([
    { role: "user" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "I should use the weather tool." },
        { type: "tool-call", id: "call_weather", providerMetadata: undefined },
      ],
    },
    { role: "tool", content: [{ type: "tool-result", id: "call_weather" }] },
    { role: "user", content: [{ type: "text", text: continuation }] },
  ])
  expect(prepared.body.messages).toMatchObject([
    { role: "user", content: [{ type: "text", text: "Look up the weather." }] },
    {
      role: "assistant",
      content: [
        { type: "text", text: "I should use the weather tool." },
        { type: "tool_use", id: "call_weather", name: "lookup_weather", input: { city: "Paris" } },
      ],
    },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "call_weather", content: "sunny" }] },
    { role: "user", content: [{ type: "text", text: continuation }] },
  ])
})
