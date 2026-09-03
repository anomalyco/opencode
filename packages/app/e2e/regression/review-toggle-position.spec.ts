import { base64Encode } from "@opencode-ai/util/encode"
import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/ReviewTogglePosition"
const sessionID = "ses_review_toggle_position"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

for (const width of [1000, 1440]) {
  for (const direction of ["ltr", "rtl"] as const) {
    test(`keeps the review toggle at the outer header edge (${width}px, ${direction})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await mockOpenCodeServer(page, {
        directory,
        project: {
          id: "proj_review_toggle_position",
          worktree: directory,
          vcs: "git",
          name: "review-toggle-position",
          time: { created: 1700000000000, updated: 1700000000000 },
          sandboxes: [],
        },
        provider: { all: [], connected: [], default: {} },
        sessions: [
          {
            id: sessionID,
            slug: "review-toggle-position",
            projectID: "proj_review_toggle_position",
            directory,
            title: "Review toggle position",
            version: "dev",
            time: { created: 1700000000000, updated: 1700000000000 },
          },
        ],
        pageMessages: () => ({ items: [] }),
      })
      await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
      await expectSessionTitle(page, "Review toggle position")
      await page.locator("html").evaluate((element, dir) => element.setAttribute("dir", dir), direction)

      const toggle = page.getByRole("button", { name: "Toggle review", exact: true })
      const header = page.locator("[data-session-title]")
      const panel = page.locator("#review-panel")
      await expect(toggle).toHaveAttribute("aria-expanded", "false")
      const closed = await toggle.boundingBox()
      if (!closed) throw new Error("Review toggle bounds are unavailable")
      const headerBox = await header.boundingBox()
      if (!headerBox) throw new Error("Session header bounds are unavailable")
      expect(closed.y).toBeGreaterThanOrEqual(headerBox.y)
      expect(closed.y + closed.height).toBeLessThanOrEqual(headerBox.y + headerBox.height)

      await toggle.click()
      await expect(toggle).toHaveAttribute("aria-expanded", "true")
      await expect(panel).toHaveAttribute("aria-hidden", "false")
      await expect(toggle).toHaveCount(1)
      await expect.poll(() => toggle.boundingBox()).toEqual(closed)
      await expect
        .poll(async () => {
          const box = await panel.boundingBox()
          if (!box) return false
          return (
            closed.x >= box.x &&
            closed.x + closed.width <= box.x + box.width &&
            closed.y >= box.y &&
            closed.y + closed.height <= box.y + 52
          )
        })
        .toBe(true)

      await expect
        .poll(async () => {
          const box = await panel.locator('[data-slot="session-side-panel-actions"]').boundingBox()
          return box ? box.y + box.height / 2 : undefined
        })
        .toBe(closed.y + closed.height / 2)

      await toggle.press("Enter")
      await expect(toggle).toHaveAttribute("aria-expanded", "false")
      await expect(toggle).toBeFocused()
      await expect(toggle).toHaveCount(1)
      await expect.poll(() => toggle.boundingBox()).toEqual(closed)
    })
  }
}
