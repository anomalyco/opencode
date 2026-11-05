import { expect, test } from "bun:test"
import type { OpenCodeEvent, SessionInfo } from "@opencode/client/promise"
import { createSidebarSessionActivity, isSidebarSessionActivity, mergeSidebarSessions } from "./sidebar-sessions"

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
  expect(
    mergeSidebarSessions(
      [session],
      [{ ...session, title: "Loaded title", time: { created: 1, updated } }],
      () => undefined,
    ),
  ).toEqual([{ ...session, title: "Loaded title" }])
})

test("includes newly created sessions that are not in the fetched index yet", () => {
  const created = { ...session, id: "ses_new", time: { created: 20, updated: 20 } }

  expect(mergeSidebarSessions([session], [created], () => undefined)).toEqual([session, created])
})

test("real activity advances the indexed timestamp without treating loaded metadata as activity", () => {
  expect(mergeSidebarSessions([session], [{ ...session, time: { created: 1, updated: 100 } }], () => 50)).toEqual([
    { ...session, time: { created: 1, updated: 50 } },
  ])
})

const envelope = {
  id: "evt_sidebar",
  created: 50,
  durable: { aggregateID: session.id, seq: 1, version: 1 as const },
}

test("records the first activity for a previously unseen server and session", () => {
  const activity = createSidebarSessionActivity()

  expect(activity.get("server", session.id)).toBeUndefined()
  activity.update("server", { ...envelope, type: "session.viewed", data: { sessionID: session.id, idle: 10 } })
  expect(activity.get("server", session.id)).toBeUndefined()
  activity.update("server", {
    ...envelope,
    type: "session.inbox.enqueued",
    data: {
      sessionID: session.id,
      inboxID: "msg_sidebar",
      item: { type: "user", payload: { text: "Hello" }, delivery: "steer" },
    },
  })
  expect(activity.get("server", session.id)).toBe(50)
})

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
] satisfies { event: OpenCodeEvent; expected: boolean }[])(
  "$event.type counts as sidebar activity: $expected",
  ({ event, expected }) => {
    expect(isSidebarSessionActivity(event)).toBe(expected)
  },
)
