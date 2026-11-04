import { expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo, SessionMessageUser } from "@opencode/client/promise"
import { selectSessionUserMessages, selectVisibleSessionUserMessages } from "./session-domain"

const user = (id: string): SessionMessageUser => ({
  id,
  type: "user",
  text: id,
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

test("selects user history strictly before the revert boundary", () => {
  const messages: SessionMessageInfo[] = [user("msg_a"), assistant, user("msg_b"), user("msg_c")]
  const users = selectSessionUserMessages(messages)

  expect(users.map((message) => message.id)).toEqual(["msg_a", "msg_b", "msg_c"])
  expect(selectVisibleSessionUserMessages(users, "msg_b").map((message) => message.id)).toEqual(["msg_a"])
  expect(selectVisibleSessionUserMessages(users.slice(2), "msg_b")).toEqual([])
  expect(selectVisibleSessionUserMessages(users)).toBe(users)
})
