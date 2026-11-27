import { expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo, SessionMessageUser } from "@opencode/client/promise"
import { selectSessionUserMessages, selectUnansweredPrompt, selectVisibleSessionUserMessages } from "./session-domain"

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

test("the revert hides by transcript position, not by message ID", () => {
  // Automation prompt IDs sort after every other message ID, and a steered prompt keeps its send-time ID.
  const users = [user("msg_1"), user("msg_aut_1"), user("msg_3"), user("msg_2"), user("msg_4")]

  expect(selectVisibleSessionUserMessages(users, "msg_2").map((message) => message.id)).toEqual([
    "msg_1",
    "msg_aut_1",
    "msg_3",
  ])
  // Without the boundary loaded its position is unknown, so IDs decide.
  expect(selectVisibleSessionUserMessages(users.slice(0, 3), "msg_2").map((message) => message.id)).toEqual(["msg_1"])
})

test.each([
  ["only reasoning", [{ type: "reasoning", text: "Thinking" }], "msg_b"],
  ["text", [{ type: "text", text: "Hello" }], undefined],
] satisfies [string, SessionMessageAssistant["content"], string | undefined][])(
  "the latest prompt is unanswered until text or a tool call follows it: %s",
  (_name, content, expected) => {
    const reply = { ...assistant, id: "msg_c", content }
    const messages: SessionMessageInfo[] = [user("msg_a"), assistant, user("msg_b"), reply]

    expect(selectUnansweredPrompt(messages)?.id).toBe(expected)
  },
)

test("the latest prompt is not unanswered once something else has run after it", () => {
  const shell: SessionMessageInfo = {
    id: "msg_c",
    type: "shell",
    shellID: "shl_1",
    command: "sleep 60",
    status: "running",
    time: { created: 0 },
  }

  expect(selectUnansweredPrompt([user("msg_a"), { ...assistant, id: "msg_b" }, shell])).toBeUndefined()
})
