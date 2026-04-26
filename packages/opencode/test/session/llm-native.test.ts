import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { LLMNative } from "../../src/session/llm-native"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ProviderTest } from "../fake/provider"
import type { MessageV2 } from "../../src/session/message-v2"
import type { Provider } from "../../src/provider"

const sessionID = SessionID.descending()

const model = (input: Partial<Provider.Model> = {}) =>
  ProviderTest.model({
    id: ModelID.make("gpt-5"),
    providerID: ProviderID.openai,
    api: { id: "gpt-5", url: "https://api.openai.com/v1", npm: "@ai-sdk/openai" },
    ...input,
  })

const textPart = (messageID: MessageID, text: string, input: Partial<MessageV2.TextPart> = {}): MessageV2.TextPart => ({
  id: PartID.ascending(),
  sessionID,
  messageID,
  type: "text",
  text,
  ...input,
})

const userMessage = (mdl: Provider.Model, id: MessageID, parts: MessageV2.Part[]): MessageV2.WithParts => {
  return {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: mdl.providerID, modelID: mdl.id },
    },
    parts,
  }
}

const assistantMessage = (
  mdl: Provider.Model,
  id: MessageID,
  parentID: MessageID,
  parts: MessageV2.Part[],
): MessageV2.WithParts => {
  return {
    info: {
      id,
      sessionID,
      role: "assistant",
      time: { created: 2 },
      parentID,
      modelID: mdl.id,
      providerID: mdl.providerID,
      mode: "build",
      agent: "build",
      path: { cwd: "/tmp/project", root: "/tmp/project" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    },
    parts,
  }
}

describe("LLMNative.request", () => {
  test("builds a text-only native LLM request", async () => {
    const mdl = model()
    const provider = ProviderTest.info({ id: ProviderID.openai, key: "openai-key" }, mdl)
    const userID = MessageID.ascending()
    const assistantID = MessageID.ascending()

    const request = await Effect.runPromise(
      LLMNative.request({
        id: "request-1",
        provider,
        model: mdl,
        system: ["You are concise.", ""],
        generation: { maxTokens: 123, temperature: 0.2, topP: 0.9 },
        messages: [
          userMessage(mdl, userID, [textPart(userID, "ignored", { ignored: true }), textPart(userID, "Hello")]),
          assistantMessage(mdl, assistantID, userID, [textPart(assistantID, "Hi")]),
        ],
      }),
    )

    expect(request).toMatchObject({
      id: "request-1",
      model: {
        id: "gpt-5",
        provider: "openai",
        protocol: "openai-responses",
        headers: { authorization: "Bearer openai-key" },
      },
      system: [{ type: "text", text: "You are concise." }],
      generation: { maxTokens: 123, temperature: 0.2, topP: 0.9 },
      tools: [],
    })
    expect(request.messages.map((message) => ({ id: message.id, role: message.role, content: message.content }))).toEqual([
      { id: userID, role: "user", content: [{ type: "text", text: "Hello" }] },
      { id: assistantID, role: "assistant", content: [{ type: "text", text: "Hi" }] },
    ])
  })
})
