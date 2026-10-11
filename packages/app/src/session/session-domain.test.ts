import { Provider } from "@opencode/schema/provider"
import { Model } from "@opencode/schema/model"
import { Agent } from "@opencode/schema/agent"
import { SessionMessage } from "@opencode/schema/session-message"
import { expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo, SessionMessageUser } from "@opencode/client/promise"
import { selectSessionUserMessages, selectVisibleSessionUserMessages } from "./session-domain"

const user = (id: string): SessionMessageUser => ({
  id: SessionMessage.ID.make(id, { disableChecks: true }),
  type: "user",
  text: id,
  time: { created: 0 },
})

const assistant: SessionMessageAssistant = {
  id: SessionMessage.ID.make("msg_2", { disableChecks: true }),
  type: "assistant",
  time: { created: 0 },
  agent: Agent.ID.make("build", { disableChecks: true }),
  model: {
    id: Model.ID.make("model", { disableChecks: true }),
    providerID: Provider.ID.make("provider", { disableChecks: true }),
  },
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
