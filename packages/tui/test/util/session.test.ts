import { SessionMessage } from "@opencode/schema/session-message"
import { Session } from "@opencode/schema/session"
import { Provider } from "@opencode/schema/provider"
import { Model } from "@opencode/schema/model"
import { Agent } from "@opencode/schema/agent"
import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import { lastAssistantWithUsage, sessionFamily } from "../../src/util/session"

const assistant = (id: string, input: number): SessionMessageInfo => ({
  id: SessionMessage.ID.make(id, { disableChecks: true }),
  type: "assistant",
  agent: Agent.ID.make("build", { disableChecks: true }),
  model: {
    id: Model.ID.make("model", { disableChecks: true }),
    providerID: Provider.ID.make("provider", { disableChecks: true }),
  },
  content: [],
  tokens: { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0 },
})

describe("util.session", () => {
  test("flattens nested subagents from any session in the family", () => {
    const sessions = [
      { id: "root" },
      { id: "child-a", parentID: Session.ID.make("root", { disableChecks: true }) },
      { id: "grandchild-a", parentID: Session.ID.make("child-a", { disableChecks: true }) },
      { id: "great-grandchild-a", parentID: Session.ID.make("grandchild-a", { disableChecks: true }) },
      { id: "grandchild-a2", parentID: Session.ID.make("child-a", { disableChecks: true }) },
      { id: "child-b", parentID: Session.ID.make("root", { disableChecks: true }) },
      { id: "grandchild-b", parentID: Session.ID.make("child-b", { disableChecks: true }) },
    ]

    expect(sessionFamily(sessions, Session.ID.make("great-grandchild-a", { disableChecks: true }))).toEqual([
      { session: sessions[1], prefix: "" },
      { session: sessions[2], prefix: "├─ " },
      { session: sessions[3], prefix: "│  └─ " },
      { session: sessions[4], prefix: "└─ " },
      { session: sessions[5], prefix: "" },
      { session: sessions[6], prefix: "└─ " },
    ])
  })

  test("tracks usage across undo and redo boundaries", () => {
    const messages = [
      assistant(SessionMessage.ID.make("msg_z", { disableChecks: true }), 10),
      assistant(SessionMessage.ID.make("msg_a", { disableChecks: true }), 30),
    ]

    expect(lastAssistantWithUsage(messages)?.tokens.input).toBe(30)
    expect(
      lastAssistantWithUsage(messages, SessionMessage.ID.make("msg_a", { disableChecks: true }))?.tokens.input,
    ).toBe(10)
    expect(
      lastAssistantWithUsage(messages, SessionMessage.ID.make("msg_missing", { disableChecks: true })),
    ).toBeUndefined()
    expect(lastAssistantWithUsage(messages)?.tokens.input).toBe(30)
  })

  test("resets usage at completed compaction until the next assistant reports it", () => {
    const compaction: SessionMessageInfo = {
      id: SessionMessage.ID.make("msg_compaction", { disableChecks: true }),
      type: "compaction",
      status: "completed",
      reason: "manual",
      summary: "Current state",
      recent: "",
      time: { created: 0 },
    }
    const messages = [assistant(SessionMessage.ID.make("msg_before", { disableChecks: true }), 30), compaction]

    expect(lastAssistantWithUsage(messages)).toBeUndefined()

    messages.push(assistant(SessionMessage.ID.make("msg_after", { disableChecks: true }), 5))
    expect(lastAssistantWithUsage(messages)?.tokens.input).toBe(5)
  })
})
