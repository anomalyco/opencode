import { expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo, SessionMessageUser } from "@opencode/client/promise"
import { messagesBefore, selectSessionUserMessages, selectVisibleSessionUserMessages } from "./session-domain"

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
  expect(selectVisibleSessionUserMessages(messages, "msg_b").map((message) => message.id)).toEqual(["msg_a"])
  expect(selectVisibleSessionUserMessages(messages.slice(3), "msg_b")).toEqual([])
  expect(selectVisibleSessionUserMessages(messages).map((message) => message.id)).toEqual(["msg_a", "msg_b", "msg_c"])
})

test("keeps the user message before a revert staged on an assistant message", () => {
  const messages: SessionMessageInfo[] = [user("msg_a"), assistant, user("msg_b")]

  expect(selectVisibleSessionUserMessages(messages, assistant.id).map((message) => message.id)).toEqual(["msg_a"])
})

// The server orders by sequence. Forked IDs end in `_<seq>`, where `_10` sorts before `_9`, and iOS mints
// uppercase IDs, which sort before lowercase ones.
const forked = ["msg_fork_8", "msg_fork_9", "msg_fork_10", "msg_fork_11"].map(user)

const mixed = ["msg_d4f1", "msg_A47D", "msg_e2b9"].map(user)

test("hides user history from the revert boundary by list position, not ID order", () => {
  expect(selectVisibleSessionUserMessages(forked, "msg_fork_10").map((message) => message.id)).toEqual([
    "msg_fork_8",
    "msg_fork_9",
  ])
  expect(selectVisibleSessionUserMessages(mixed, "msg_A47D").map((message) => message.id)).toEqual(["msg_d4f1"])
})

// The timeline detects a new tail turn by finding the previous tail before it.
test("finds earlier messages by list position, not ID order", () => {
  expect(messagesBefore(forked, "msg_fork_10").map((message) => message.id)).toContain("msg_fork_9")
  expect(messagesBefore(mixed, "msg_e2b9").map((message) => message.id)).toContain("msg_A47D")
})
