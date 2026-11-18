import { expect, test } from "bun:test"
import type { OpenCodeEvent, SessionInfo } from "@opencode/client/promise"
import { isSidebarSessionActivity, mergeSidebarSessions } from "./sidebar-sessions"

const session: SessionInfo = {
  id: "ses_sidebar",
  projectID: "project",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 10 },
  title: "Indexed title",
  location: { directory: "/project" },
}

test.each([5, 50])("loading metadata with timestamp %i does not move an indexed session", (updated) => {
  expect(mergeSidebarSessions([session], [{ ...session, title: "Loaded title", time: { created: 1, updated } }])).toEqual(
    [{ ...session, title: "Loaded title" }],
  )
})

test("includes newly created sessions that are not in the fetched index yet", () => {
  const created = { ...session, id: "ses_new", time: { created: 20, updated: 20 } }

  expect(mergeSidebarSessions([session], [created])).toEqual([session, created])
})

test("a run that ended after the index fetch moves the session to the server's order", () => {
  const active = { ...session, time: { created: 1, updated: 50, idle: 50 } }

  expect(mergeSidebarSessions([{ ...session, time: { created: 1, updated: 10 } }], [active])).toEqual([active])
})

const envelope = {
  id: "evt_sidebar",
  created: 50,
  durable: { aggregateID: session.id, seq: 1, version: 1 as const },
}

test.each([
  { event: { ...envelope, type: "session.viewed", data: { sessionID: session.id, idle: 10 } }, expected: false },
  {
    event: {
      ...envelope,
      type: "session.metadata.updated",
      data: { sessionID: session.id, metadata: { viewed: true } },
    },
    expected: false,
  },
  {
    event: { ...envelope, type: "session.agent.selected", data: { sessionID: session.id, agent: "build" } },
    expected: false,
  },
  {
    event: {
      ...envelope,
      type: "session.model.selected",
      data: { sessionID: session.id, model: { providerID: "provider", id: "model" } },
    },
    expected: false,
  },
  {
    event: { ...envelope, type: "session.renamed", data: { sessionID: session.id, title: "New title" } },
    expected: true,
  },
  {
    event: {
      ...envelope,
      type: "session.inbox.enqueued",
      data: {
        sessionID: session.id,
        inboxID: "msg_sidebar",
        item: { type: "user", payload: { text: "Hello" }, delivery: "steer" },
      },
    },
    expected: true,
  },
  {
    event: {
      ...envelope,
      type: "session.step.started",
      data: {
        sessionID: session.id,
        assistantMessageID: "msg_assistant",
        agent: "build",
        model: { providerID: "provider", id: "model" },
        started: 50,
      },
    },
    expected: true,
  },
] satisfies { event: OpenCodeEvent; expected: boolean }[])(
  "$event.type keeps a preview: $expected",
  ({ event, expected }) => {
    expect(isSidebarSessionActivity(event)).toBe(expected)
  },
)
