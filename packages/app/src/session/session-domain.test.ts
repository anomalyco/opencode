import { expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo, SessionMessageUser } from "@opencode/client/promise"
import { selectSessionUserMessages, selectUnansweredPrompt, selectVisibleSessionMessages } from "./session-domain"

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

test("selects the transcript strictly before the revert boundary", () => {
  const messages: SessionMessageInfo[] = [user("msg_a"), assistant, user("msg_b"), user("msg_c")]

  expect(selectSessionUserMessages(messages).map((message) => message.id)).toEqual(["msg_a", "msg_b", "msg_c"])
  expect(selectVisibleSessionMessages(messages, { messageID: "msg_b" }).map((message) => message.id)).toEqual([
    "msg_a",
    "msg_2",
  ])
  // The boundary can be a reply, not just a prompt.
  expect(selectVisibleSessionMessages(messages, { messageID: "msg_2" }).map((message) => message.id)).toEqual(["msg_a"])
  expect(selectVisibleSessionMessages(messages)).toBe(messages)
})

test("the revert hides by transcript position, not by message ID", () => {
  // Automation prompt IDs sort after every other message ID, and a steered prompt keeps its send-time ID.
  const messages = [user("msg_1"), user("msg_aut_1"), user("msg_3"), user("msg_2"), user("msg_4")]

  expect(selectVisibleSessionMessages(messages, { messageID: "msg_2" }).map((message) => message.id)).toEqual([
    "msg_1",
    "msg_aut_1",
    "msg_3",
  ])
})

test.each([
  ["an automation prompt", "msg_aut_1"],
  ["a forked copy", "msg_fork_10"],
])("an unloaded boundary on %s hides by its seq", (_name, messageID) => {
  // Forked copies end in an unpadded seq, so `_10` sorts before `_9`; neither ID says where they sit.
  const loaded = [
    { ...user("msg_fork_9"), seq: 9 },
    { ...user("msg_aut_2"), seq: 11 },
    { ...user("msg_0newer"), seq: 12 },
  ]

  expect(selectVisibleSessionMessages(loaded, { messageID, seq: 10 }).map((message) => message.id)).toEqual([
    "msg_fork_9",
  ])
})

test("without any seq, an unloaded boundary is older than every loaded message", () => {
  // Loaded messages are always the newest part of the transcript, so nothing loaded survives, whatever the IDs say.
  expect(selectVisibleSessionMessages([user("msg_1"), user("msg_aut_2")], { messageID: "msg_aut_1" })).toEqual([])
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
