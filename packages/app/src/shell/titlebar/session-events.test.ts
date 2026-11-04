import { expect, test } from "bun:test"
import type { ServerConnection } from "@/runtime/server/registry"
import { readSessionTabsRemovedDetail, SESSION_TABS_REMOVED_EVENT } from "./session-events"

const details: { name: string; event: Event; expected: ReturnType<typeof readSessionTabsRemovedDetail> }[] = [
  { name: "an event without detail", event: new Event(SESSION_TABS_REMOVED_EVENT), expected: undefined },
  {
    name: "a detail without a server",
    event: new CustomEvent(SESSION_TABS_REMOVED_EVENT, { detail: { directory: "/tmp/project", sessionIDs: [] } }),
    expected: undefined,
  },
  {
    name: "non-string session IDs",
    event: new CustomEvent(SESSION_TABS_REMOVED_EVENT, {
      detail: { server: "remote", directory: "/tmp/project", sessionIDs: ["ses_1", "ses_2", 1] },
    }),
    expected: { server: "remote" as ServerConnection.Key, directory: "/tmp/project", sessionIDs: ["ses_1", "ses_2"] },
  },
]

test.each(details)("removed session tab details validate $name", ({ event, expected }) => {
  expect(readSessionTabsRemovedDetail(event)).toEqual(expected)
})
