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

test.each([
  ["nothing after it", [], "msg_b"],
  ["only reasoning", [{ type: "reasoning", text: "Thinking" }], "msg_b"],
  ["blank text", [{ type: "text", text: " \n" }], "msg_b"],
  ["text", [{ type: "text", text: "Hello" }], undefined],
  [
    "a tool call",
    [{ type: "tool", id: "call_1", name: "read", state: { status: "streaming", input: "" }, time: { created: 0 } }],
    undefined,
  ],
] satisfies [string, SessionMessageAssistant["content"], string | undefined][])(
  "the latest prompt is unanswered until text or a tool call follows it: %s",
  (_name, content, expected) => {
    const reply = { ...assistant, id: "msg_c", content }
    const messages: SessionMessageInfo[] = [user("msg_a"), assistant, user("msg_b"), ...(content.length ? [reply] : [])]

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
