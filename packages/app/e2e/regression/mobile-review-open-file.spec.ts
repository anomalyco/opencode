import { expect, test } from "@playwright/test"
import { fixture, pageMessages } from "../performance/timeline/session-timeline-stress.fixture"
import { stressSessionHref } from "../performance/timeline/timeline-test-helpers"
import { mockOpenCodeServer } from "../utils/mock-server"

test("opening changed files selects the requested tab before file loading completes", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const loading = Promise.withResolvers<void>()
  await mockOpenCodeServer(page, {
    directory: fixture.directory,
    project: fixture.project,
    sessions: fixture.sessions,
    provider: fixture.provider,
    pageMessages,
    fileList: () => [],
    fileContent: async (path) => {
      if (path === "second.ts") await loading.promise
      return `contents:${path}`
    },
    vcsDiff: ["first.ts", "second.ts"].map((file) => ({
      file,
      status: "modified",
      additions: 1,
      deletions: 1,
      patch: `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n-before\n+after\n`,
    })),
  })
  await page.goto(stressSessionHref(fixture.targetID))
  const navigation = page.getByRole("tablist", { name: "Session view", exact: true })
  const files = page.locator('[data-slot="session-mobile-files"]')
  for (const file of ["first.ts", "second.ts", "first.ts", "second.ts"]) {
    await navigation.getByRole("tab", { name: "Changes", exact: true }).click()
    const diff = page.locator(`[data-component="session-review"] [data-file="${file}"]`)
    const header = diff.getByRole("button", { name: file, exact: true })
    await expect(header).toBeEnabled()
    if ((await header.getAttribute("aria-expanded")) === "false") await header.click()
    await diff.getByRole("button", { name: "Open file", exact: true }).click()
    await expect(navigation.getByRole("tab", { name: "Files", exact: true })).toHaveAttribute("aria-selected", "true")
    await expect(files.getByRole("tab", { name: file, exact: true })).toHaveAttribute("aria-selected", "true")
    if (file === "second.ts") loading.resolve()
    await expect(files.getByText(`contents:${file}`, { exact: true })).toBeVisible()
  }
})
