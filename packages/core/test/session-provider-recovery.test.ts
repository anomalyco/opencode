import { expect, test } from "bun:test"
import { LLM, Message } from "@opencode-ai/ai"
import { configure } from "@opencode-ai/ai/providers/google"
import { compileRequest } from "@opencode-ai/ai/route/client"
import { Agent } from "@opencode-ai/core/agent"
import { Model } from "@opencode-ai/core/model"
import { Provider } from "@opencode-ai/core/provider"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { toLLMMessages } from "@opencode-ai/core/session/runner/to-llm-message"
import { DateTime, Effect } from "effect"

const created = DateTime.makeUnsafe(0)
const google = Model.Ref.make({
  id: Model.ID.make("gemini-3.5-flash"),
  providerID: Provider.ID.make("google"),
})
const continuation =
  "The previous response was interrupted. Continue from where you left off without repeating completed content."

test("failed Gemini tool history replays through the public request boundary", async () => {
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
        model: google,
        content: [
          SessionMessage.AssistantReasoning.make({
            type: "reasoning",
            text: "I should use the weather tool.",
            state: { thoughtSignature: "signed-reasoning" },
          }),
          SessionMessage.AssistantTool.make({
            type: "tool",
            id: "call_weather",
            name: "lookup_weather",
            executed: false,
            providerState: { thoughtSignature: "signed-tool-call" },
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
    google,
  )
  const prepared = await Effect.runPromise(
    compileRequest(
      LLM.request({
        model: configure({ apiKey: "test" }).model("gemini-3.5-flash"),
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
  expect(prepared.body.contents).toEqual([
    { role: "user", parts: [{ text: "Look up the weather." }] },
    {
      role: "model",
      parts: [
        { text: "I should use the weather tool.", thoughtSignature: undefined },
        {
          functionCall: { id: undefined, name: "lookup_weather", args: { city: "Paris" } },
          thoughtSignature: "skip_thought_signature_validator",
        },
      ],
    },
    {
      role: "user",
      parts: [
        {
          functionResponse: {
            id: undefined,
            name: "lookup_weather",
            response: { name: "lookup_weather", content: "sunny" },
          },
        },
      ],
    },
    { role: "user", parts: [{ text: continuation }] },
  ])
})
