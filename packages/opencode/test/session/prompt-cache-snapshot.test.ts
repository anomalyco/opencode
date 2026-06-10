import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { Provider } from "@/provider/provider"
import { appendOnlyModelMessages } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"

const sessionID = SessionID.make("session")
const providerID = ProviderV2.ID.make("test")
const model: Provider.Model = {
  id: ModelV2.ID.make("test-model"),
  providerID,
  api: {
    id: "test-model",
    url: "https://example.com",
    npm: "@ai-sdk/openai",
  },
  name: "Test Model",
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 0, input: 0, output: 0 },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-01-01",
}

function userInfo(id: string): SessionV1.User {
  return {
    id: MessageID.make(id),
    sessionID,
    role: "user",
    time: { created: 0 },
    agent: "user",
    model: { providerID, modelID: ModelV2.ID.make("test") },
    tools: {},
    mode: "",
  } as unknown as SessionV1.User
}

function textMessage(messageID: string, partID: string, text: string): SessionV1.WithParts {
  return {
    info: userInfo(messageID),
    parts: [
      {
        id: PartID.make(partID),
        sessionID,
        messageID: MessageID.make(messageID),
        type: "text",
        text,
      },
    ] as SessionV1.Part[],
  }
}

describe("session.prompt.appendOnlyModelMessages", () => {
  test("preserves previously serialized model messages after source messages mutate", async () => {
    const firstMessage = textMessage("msg_first", "prt_first", "stable prefix")
    const secondMessage = textMessage("msg_second", "prt_second", "new suffix")

    const first = await Effect.runPromise(
      appendOnlyModelMessages({ snapshot: undefined, messages: [firstMessage], model }),
    )

    const firstText = firstMessage.parts.find((part): part is SessionV1.TextPart => part.type === "text")
    expect(firstText).toBeDefined()
    if (firstText) firstText.text = "mutated prefix"

    const second = await Effect.runPromise(
      appendOnlyModelMessages({ snapshot: first.snapshot, messages: [firstMessage, secondMessage], model }),
    )

    expect(second.modelMessages).toStrictEqual([
      { role: "user", content: [{ type: "text", text: "stable prefix" }] },
      { role: "user", content: [{ type: "text", text: "new suffix" }] },
    ])
  })
})
