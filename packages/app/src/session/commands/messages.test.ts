import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo, SessionMessageUser } from "@opencode-ai/client/promise"
import type { ServerApi } from "@/runtime/server/api"
import { fetchSessionMessages, selectForkableUserMessages } from "./messages"

describe("fetchSessionMessages", () => {
  test("fetches every native message page without returning cursors", async () => {
    const first = { id: "msg_1", type: "model-selected" } as unknown as SessionMessageInfo
    const second = { id: "msg_2", type: "user" } as SessionMessageInfo
    const calls: unknown[] = []
    const api = {
      message: {
        list: async (input: { cursor?: string }) => {
          calls.push(input)
          if (!input.cursor) return { data: [first], cursor: { next: "page-2" } }
          return { data: [second], cursor: {} }
        },
      },
    } as unknown as Pick<ServerApi, "message">

    const result = await fetchSessionMessages({ sessionID: "ses_1", api })

    expect(result).toEqual([first, second])
    expect(calls).toEqual([
      { sessionID: "ses_1", limit: 200, order: "asc" },
      { sessionID: "ses_1", limit: 200, cursor: "page-2" },
    ])
  })
})

describe("selectForkableUserMessages", () => {
  const user = (id: string, text = id): SessionMessageUser => ({
    id,
    type: "user",
    text,
    time: { created: 0 },
  })
  const assistant: SessionMessageAssistant = {
    id: "msg_2",
    type: "assistant",
    time: { created: 0 },
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content: [],
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }

  test("keeps visible user prompts and skips empty text", () => {
    const messages: SessionMessageInfo[] = [user("msg_a"), assistant, user("msg_b", ""), user("msg_c")]
    expect(selectForkableUserMessages(messages).map((message) => message.id)).toEqual(["msg_a", "msg_c"])
    expect(selectForkableUserMessages(messages, "msg_c").map((message) => message.id)).toEqual(["msg_a"])
  })
})
