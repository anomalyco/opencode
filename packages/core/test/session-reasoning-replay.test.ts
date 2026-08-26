import { describe, expect } from "bun:test"
import { LLM } from "@opencode-ai/ai"
import { AnthropicMessages } from "@opencode-ai/ai/protocols/anthropic-messages"
import { Gemini } from "@opencode-ai/ai/protocols/gemini"
import { OpenAIChat } from "@opencode-ai/ai/protocols/openai-chat"
import { OpenAIResponses } from "@opencode-ai/ai/protocols/openai-responses"
import { Auth } from "@opencode-ai/ai/route"
import { compileRequest } from "@opencode-ai/ai/route/client"
import { Agent } from "@opencode-ai/core/agent"
import { Model } from "@opencode-ai/core/model"
import { Provider } from "@opencode-ai/core/provider"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { toLLMMessages } from "@opencode-ai/core/session/runner/to-llm-message"
import { DateTime, Effect } from "effect"
import { it } from "./lib/effect"

const source = SessionMessage.Assistant.make({
  id: SessionMessage.ID.make("msg_reasoning_switch"),
  type: "assistant",
  agent: Agent.defaultID,
  model: { id: Model.ID.make("source-model"), providerID: Provider.ID.make("source-provider") },
  content: [
    {
      type: "reasoning",
      text: "Check the constraints.",
      state: {
        reasoningField: "source_reasoning",
        reasoningDetails: [{ type: "reasoning.encrypted", data: "old-encrypted-state" }],
      },
    },
    { type: "text", text: "Use this approach." },
  ],
  time: { created: DateTime.makeUnsafe(0) },
})

describe("reasoning replay after a provider switch", () => {
  const destinations = [
    {
      name: "Chat Completions uses its default reasoning field",
      model: OpenAIChat.route.with({ auth: Auth.none }).model({ id: "target-model" }),
      body: {
        messages: [{ role: "assistant", content: "Use this approach.", reasoning_content: "Check the constraints." }],
      },
    },
    {
      name: "Chat Completions uses the destination's configured reasoning field",
      model: OpenAIChat.route.with({ auth: Auth.none }).model({
        id: "target-model",
        compatibility: { reasoningField: "reasoning_text" },
      }),
      body: {
        messages: [{ role: "assistant", content: "Use this approach.", reasoning_text: "Check the constraints." }],
      },
    },
    {
      name: "Claude retains its unsigned-reasoning text fallback",
      model: AnthropicMessages.route.with({ auth: Auth.none }).model({ id: "claude-sonnet-4-5" }),
      body: {
        messages: [
          {
            role: "assistant",
            content: [
              { type: "text", text: "Check the constraints." },
              { type: "text", text: "Use this approach." },
            ],
          },
        ],
      },
    },
    {
      name: "Kimi's Anthropic endpoint preserves unsigned thinking",
      model: AnthropicMessages.route.with({ auth: Auth.none, provider: "moonshotai" }).model({ id: "kimi-k2.6" }),
      body: {
        messages: [
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "Check the constraints.", signature: "" },
              { type: "text", text: "Use this approach." },
            ],
          },
        ],
      },
    },
    {
      name: "Gemini preserves the thought flag without a signature",
      model: Gemini.route.with({ auth: Auth.none }).model({ id: "gemini-3-flash-preview" }),
      body: {
        contents: [
          { role: "model", parts: [{ text: "Check the constraints.", thought: true }, { text: "Use this approach." }] },
        ],
      },
    },
    {
      name: "Responses retains its omission of reasoning without replay state",
      model: OpenAIResponses.route.with({ auth: Auth.none }).model({ id: "gpt-5.5" }),
      body: {
        input: [{ role: "assistant", content: [{ type: "output_text", text: "Use this approach." }] }],
      },
    },
  ]

  destinations.forEach((destination) => {
    it.effect(destination.name, () =>
      Effect.gen(function* () {
        const messages = toLLMMessages(
          [source],
          Model.Ref.make({
            id: Model.ID.make(destination.model.id),
            providerID: Provider.ID.make(destination.model.provider),
          }),
          destination.model.route.providerMetadataKey,
        )
        expect(messages[0]?.content).toEqual([
          { type: "reasoning", text: "Check the constraints." },
          { type: "text", text: "Use this approach.", providerMetadata: undefined },
        ])
        const prepared = yield* compileRequest(LLM.request({ model: destination.model, messages, cache: "none" }))
        expect(prepared.body).toMatchObject(destination.body)
      }),
    )
  })
})
