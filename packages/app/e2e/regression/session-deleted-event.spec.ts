import { expect, test } from "@playwright/test"
import type { OpenCodeEvent } from "@opencode/client/promise"
import { fixture } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

test("external deletion leaves an open tab on the missing-session screen, toasts, and removes the Home row", async ({
  page,
}) => {
  const sessions = fixture.sessions.map((session) => ({ ...session }))
  const events: OpenCodeEvent[] = []
  await mockOpenCodeServer(page, {
    sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages: () => ({ items: [] }),
    events: () => events.splice(0),
  })
  await page.addInitScript((directory) => {
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: directory, expanded: true }] },
        lastProject: { local: directory },
      }),
    )
  }, fixture.directory)

  await page.goto("/")
  const row = page.locator(`[data-component="home-session-row-container"][data-session-id="${fixture.targetID}"]`)
  await expect(row).toBeVisible()
  await row.locator('[data-component="home-session-row"]').click()
  await expect(page.getByRole("button", { name: "More options" })).toBeVisible()
  const tab = page.locator(`[data-slot="titlebar-tabs"] a[href$="/session/${fixture.targetID}"]`)
  await expect(tab).toBeVisible()

  sessions.splice(
    sessions.findIndex((session) => session.id === fixture.targetID),
    1,
  )
  events.push({
    id: "evt_target_deleted",
    created: 1700000003000,
    type: "session.deleted",
    durable: { aggregateID: fixture.targetID, seq: 1, version: 2 },
    location: { directory: fixture.directory },
    data: { sessionID: fixture.targetID },
  })

  await expect(page.getByText("This session cannot be found")).toBeVisible()
  await expect(tab).toBeVisible()
  await expect(page.getByText("Session deleted", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Home" }).click()
  await expect(
    page.locator(`[data-component="home-session-row-container"][data-session-id="${fixture.sourceID}"]`),
  ).toBeVisible()
  await expect(row).toHaveCount(0)
})

test("deletion event for a session without an open tab does not toast", async ({ page }) => {
  const sessions = fixture.sessions.map((session) => ({ ...session }))
  const events: OpenCodeEvent[] = []
  await mockOpenCodeServer(page, {
    sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages: () => ({ items: [] }),
    events: () => events.splice(0),
  })
  await page.addInitScript((directory) => {
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: directory, expanded: true }] },
        lastProject: { local: directory },
      }),
    )
  }, fixture.directory)

  await page.goto("/")
  const row = page.locator(`[data-component="home-session-row-container"][data-session-id="${fixture.targetID}"]`)
  await expect(row).toBeVisible()
  const refill = Promise.withResolvers<void>()
  await page.route(/\/api\/session(?:\?|$)/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    await refill.promise
    return route.fallback()
  })
  sessions.splice(
    sessions.findIndex((session) => session.id === fixture.targetID),
    1,
  )
  const refetch = page.waitForRequest(
    (request) => request.method() === "GET" && /\/api\/session(?:\?|$)/.test(request.url()),
  )
  events.push({
    id: "evt_unopened_deleted",
    created: 1700000003000,
    type: "session.deleted",
    durable: { aggregateID: fixture.targetID, seq: 1, version: 2 },
    location: { directory: fixture.directory },
    data: { sessionID: fixture.targetID },
  })

  try {
    await refetch
    await expect(row).toHaveCount(0)
    await expect(page.getByText("Session deleted", { exact: true })).toHaveCount(0)
  } finally {
    refill.resolve()
  }
})
