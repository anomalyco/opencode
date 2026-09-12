import { expect, test } from "bun:test"
import { SESSION_TABS_REMOVED_EVENT } from "@/components/titlebar-session-events"
import { archiveHomeSession } from "./home-session-archive"

test("archiving a Home session updates the list without touching open tabs", async () => {
  let tabsRemovedEvent = false
  window.addEventListener(SESSION_TABS_REMOVED_EVENT, () => {
    tabsRemovedEvent = true
  })

  let removed = false
  await archiveHomeSession({
    sessionID: "ses_1",
    archive: async () => undefined,
    remove: () => {
      removed = true
    },
  })

  expect(removed).toBe(true)
  expect(tabsRemovedEvent).toBe(false)
})

test("reports archive failures without removing the session", async () => {
  const failure = new Error("offline")
  let error: unknown
  let removed = false

  await archiveHomeSession({
    sessionID: "ses_1",
    archive: async () => Promise.reject(failure),
    remove: () => {
      removed = true
    },
    onError: (value) => {
      error = value
    },
  })

  expect(error).toBe(failure)
  expect(removed).toBe(false)
})
