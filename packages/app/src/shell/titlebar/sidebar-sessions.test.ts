import { expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client/promise"
import { mergeSidebarSessions } from "./sidebar-sessions"

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
