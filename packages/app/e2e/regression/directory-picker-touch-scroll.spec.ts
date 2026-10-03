import { expect, test } from "@playwright/test"
import { fixture, pageMessages } from "../smoke/session-timeline.fixture"
import { mockOpenCodeServer } from "../utils/mock-server"

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

test("directory picker scrolls when swiping over its directory rows", async ({ page }) => {
  await mockOpenCodeServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    pageMessages,
    fileList: (path) =>
      path === fixture.directory
        ? Array.from({ length: 20 }, (_, i) => ({
            name: `folder-${String(i).padStart(3, "0")}`,
            path: `folder-${String(i).padStart(3, "0")}`,
            type: "directory" as const,
            ignored: false,
          }))
        : [],
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
  await page.getByRole("button", { name: "Projects", exact: true }).click()
  await page.getByRole("button", { name: "Add project", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("button", { name: "Select folder", exact: true })).toBeEnabled()
  const tree = dialog.locator(".directory-picker-tree")
  const scroll = tree.locator("[data-file-tree-virtualized-scroll]")
  await expect.poll(() => scroll.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(120)
  const box = await scroll.boundingBox()
  if (!box) throw new Error("Directory tree has no visible bounds")
  const x = box.x + box.width / 2
  const y = box.y + box.height * 0.8
  // Exercise trusted touch input over a row, not a synthetic DOM TouchEvent.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] })
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - i * 24 }],
    })
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(80)
  await expect(scroll.getByRole("treeitem", { name: "folder-018", exact: true })).toBeInViewport()
})
