import { expect, test } from "@playwright/test"
import { REMOTE_SERVER, seed, sessionHref } from "../utils/app"
import { mockRemoteServer, mockWorkspace } from "../utils/workspace"

declare global {
  interface Window {
    recordAppBadge: (count: number) => Promise<void>
  }
}

test.use({ serviceWorkers: "block" })

test("PWA badge counts distinct unread sessions and clears viewed or deleted sessions", async ({ page }) => {
  const counts: number[] = []
  await page.exposeFunction("recordAppBadge", (count: number) => counts.push(count))
  await page.addInitScript(() => {
    navigator.setAppBadge = (count = 0) => window.recordAppBadge(count)
    navigator.clearAppBadge = () => window.recordAppBadge(0)
  })
  const workspace = await mockWorkspace(page, {
    name: "Badge",
    sessions: [
      { id: "ses_badge_a", title: "First" },
      { id: "ses_badge_b", title: "Second" },
    ],
  })
  await mockRemoteServer(page, { name: "Remote", sessions: [{ id: "ses_badge_a", title: "Remote session" }] })
  await seed(page, {
    servers: [REMOTE_SERVER],
    storage: {
      "opencode.global.dat:notification": {
        list: ["ses_badge_a", "ses_badge_a", "ses_badge_b"].map((session) => ({
          type: "turn-complete",
          session,
          directory: workspace.directory,
          time: Date.now(),
          viewed: false,
        })),
      },
    },
  })
  await page.goto("/")
  await expect.poll(() => counts.at(-1)).toBe(2)
  await page.goto(sessionHref("ses_badge_a", REMOTE_SERVER))
  await expect.poll(() => counts.at(-1)).toBe(0)
  await page.goto(sessionHref("ses_badge_a"))
  await expect.poll(() => counts.at(-1)).toBe(1)
  await workspace.push([
    {
      id: "evt_badge_delete",
      created: Date.now(),
      type: "session.deleted",
      durable: { aggregateID: "ses_badge_b", seq: 1, version: 2 },
      data: { sessionID: "ses_badge_b" },
    },
  ])
  await expect.poll(() => counts.at(-1)).toBe(0)
})
