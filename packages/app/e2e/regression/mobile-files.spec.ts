import { expect, test } from "@playwright/test"
import { fixture, pageMessages } from "../performance/timeline/session-timeline-stress.fixture"
import { stressSessionHref } from "../performance/timeline/timeline-test-helpers"
import { mockOpenCodeServer } from "../utils/mock-server"

for (const direction of ["ltr", "rtl"] as const) {
  test(`mobile files browse, search, switch, and close shared file tabs in ${direction}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await mockOpenCodeServer(page, {
      directory: fixture.directory,
      project: fixture.project,
      sessions: fixture.sessions,
      provider: fixture.provider,
      pageMessages,
      fileList: (path) =>
        path
          ? []
          : ["first.ts", "second.ts"].map((name) => ({
              name,
              path: name,
              absolute: `${fixture.directory}/${name}`,
              type: "file",
              ignored: false,
            })),
      fileContent: (path) => `contents:${path}`,
      findFiles: ({ query }) => ["first.ts", "second.ts"].filter((path) => path.includes(query)),
    })
    await page.goto(stressSessionHref(fixture.targetID))
    const navigation = page.getByRole("tablist", { name: "Session view", exact: true })
    await navigation.getByRole("tab", { name: "Files", exact: true }).click()
    const files = page.locator('[data-slot="session-mobile-files"]')
    await expect(files.getByRole("button", { name: "first.ts", exact: true })).toBeVisible()
    await page.evaluate((direction) => (document.documentElement.dir = direction), direction)
    await expect(files.locator('[data-slot="session-mobile-files-header"]')).toHaveCSS("border-bottom-width", "0px")
    await expect
      .poll(() =>
        files.getByRole("tablist", { name: "Open files", exact: true }).evaluate((element) => {
          const header = element.closest('[data-slot="session-mobile-files-header"]')!
          const separator = getComputedStyle(element, "::before")
          return {
            height: separator.height,
            fullWidth: parseFloat(separator.width) === header.clientWidth,
            start: separator.insetInlineStart,
            bottom: separator.bottom,
          }
        }),
      )
      .toEqual({ height: "1px", fullWidth: true, start: "0px", bottom: "0px" })
    await files.getByRole("button", { name: "first.ts", exact: true }).click()
    await expect(files.getByText("contents:first.ts", { exact: true })).toBeVisible()
    await files.locator('[data-column-number="1"]').click()
    const editor = files.locator('[data-component="line-comment-v2"][data-variant="editor"]')
    await expect(editor.getByRole("textbox")).toBeVisible()
    for (const width of [390, 700]) {
      await page.setViewportSize({ width, height: 844 })
      await expect
        .poll(async () => {
          const panel = await files.boundingBox()
          const comment = await editor.boundingBox()
          if (!panel || !comment) return false
          return Math.abs(comment.x - panel.x - 12) < 2 && Math.abs(comment.width - panel.width + 24) < 2
        })
        .toBe(true)
    }
    await editor.getByRole("textbox").fill("Full-width file comment")
    await editor.getByRole("button", { name: "Comment", exact: true }).click()
    const comment = files.locator('[data-component="line-comment-v2"][data-variant="display"]')
    await expect(comment).toContainText("Full-width file comment")
    await expect
      .poll(async () => {
        const panel = await files.boundingBox()
        const card = await comment.boundingBox()
        if (!panel || !card) return false
        return Math.abs(card.x - panel.x - 12) < 2 && Math.abs(card.width - panel.width + 24) < 2
      })
      .toBe(true)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(files.getByRole("combobox", { name: "Filter files", exact: true })).toBeHidden()
    await files.getByRole("button", { name: "All files", exact: true }).click()
    await files.getByRole("combobox", { name: "Filter files", exact: true }).fill("second")
    await files.getByRole("option", { name: "second.ts", exact: true }).click()
    await expect(files.getByText("contents:second.ts", { exact: true })).toBeVisible()
    const openTabs = files.getByRole("tablist", { name: "Open files", exact: true })
    await expect(openTabs.getByRole("tab")).toHaveText(["first.ts", "second.ts"])
    await expect
      .poll(() =>
        openTabs.getByRole("tab", { name: "second.ts", exact: true }).evaluate((element) => {
          const tab = element.closest('[data-slot="tabs-v2-trigger-wrapper"]')!
          const header = element.closest('[data-slot="session-mobile-files-header"]')!
          return Math.abs(tab.getBoundingClientRect().bottom - header.getBoundingClientRect().bottom) < 1
        }),
      )
      .toBe(true)
    await openTabs.getByRole("tab", { name: "first.ts", exact: true }).click()
    await expect(files.getByText("contents:first.ts", { exact: true })).toBeVisible()
    await navigation.getByRole("tab", { name: "Session", exact: true }).click()
    await navigation.getByRole("tab", { name: "Files", exact: true }).click()
    await expect(files.getByText("contents:first.ts", { exact: true })).toBeVisible()
    await files
      .locator('[data-slot="tabs-v2-trigger-wrapper"]')
      .filter({ has: page.getByRole("tab", { name: "first.ts", exact: true }) })
      .getByRole("button", { name: "Close tab", exact: true })
      .click()
    await expect(openTabs.getByRole("tab")).toHaveText(["second.ts"])
    await expect(files.getByText("contents:second.ts", { exact: true })).toBeVisible()
    await files.getByRole("button", { name: "Close tab", exact: true }).click()
    await expect(files.getByRole("combobox", { name: "Filter files", exact: true })).toBeVisible()
    await expect(openTabs.getByRole("tab")).toHaveCount(0)
  })
}
