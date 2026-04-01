import { describe, expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2/client"
import { mergeMessages } from "./quick-assistant-helpers"

const msg = (id: string, role: "user" | "assistant") =>
  ({
    id,
    sessionID: "ses_1",
    role,
    time: { created: 1 },
    agent: "assistant",
    model: { providerID: "openai", modelID: "gpt-5" },
  }) as Message

describe("mergeMessages", () => {
  test("preserves optimistic messages when fetched history is stale", () => {
    const result = mergeMessages([msg("msg_2", "user")], [])
    expect(result.map((item) => item.id)).toEqual(["msg_2"])
  })

  test("deduplicates by id and keeps fetched updates", () => {
    const result = mergeMessages([msg("msg_1", "user")], [msg("msg_1", "assistant"), msg("msg_2", "assistant")])
    expect(result.map((item) => `${item.id}:${item.role}`)).toEqual(["msg_1:assistant", "msg_2:assistant"])
  })
})
