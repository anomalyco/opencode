import { describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { formatSessionContextRaw, getSessionContextRawDerived } from "./session-context-raw"

const assistant = (providerID = "openai") => {
  return {
    id: "a1",
    role: "assistant",
    providerID,
    time: { created: 1 },
  } as unknown as Message
}

const user = () => {
  return {
    id: "u1",
    role: "user",
    time: { created: 1 },
  } as unknown as Message
}

describe("getSessionContextRawDerived", () => {
  test("prefers finish-step metadata and extracts service tier", () => {
    const parts = [
      {
        type: "text",
        text: "done",
        metadata: { openai: { itemId: "msg_1" } },
      },
      {
        type: "step-finish",
        reason: "stop",
        cost: 0,
        tokens: {
          input: 1,
          output: 1,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        metadata: { openai: { responseId: "resp_1", serviceTier: "flex" } },
      },
    ] as unknown as Part[]

    expect(getSessionContextRawDerived(assistant(), parts)).toEqual({
      providerMetadata: { openai: { responseId: "resp_1", serviceTier: "flex" } },
      serviceTier: "flex",
    })
  })

  test("falls back to latest part metadata when no finish-step metadata exists", () => {
    const parts = [
      {
        type: "tool",
        metadata: { providerExecuted: true },
      },
      {
        type: "text",
        text: "done",
        metadata: { openai: { itemId: "msg_1" } },
      },
    ] as unknown as Part[]

    expect(getSessionContextRawDerived(assistant(), parts)).toEqual({
      providerMetadata: { openai: { itemId: "msg_1" } },
    })
  })

  test("returns undefined for non-assistant messages", () => {
    expect(getSessionContextRawDerived(user(), [])).toBeUndefined()
  })

  test("omits reasoningEncryptedContent from formatted raw output", () => {
    const parts = [
      {
        type: "reasoning",
        text: "thinking",
        metadata: {
          openai: {
            itemId: "rs_1",
            reasoningEncryptedContent: "very-large-opaque-value",
          },
        },
      },
      {
        type: "step-finish",
        reason: "stop",
        cost: 0,
        tokens: {
          input: 1,
          output: 1,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        metadata: { openai: { responseId: "resp_1", serviceTier: "flex" } },
      },
    ] as unknown as Part[]

    const raw = formatSessionContextRaw(assistant(), parts)

    expect(raw).toContain('"serviceTier": "flex"')
    expect(raw).not.toContain("reasoningEncryptedContent")
    expect(raw).toContain('"responseId": "resp_1"')
  })
})
