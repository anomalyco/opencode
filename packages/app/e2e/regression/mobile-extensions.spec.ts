import { expect, test, type Page, type Request } from "@playwright/test"
import { sessionHref } from "../utils/app"
import { fixture, mockStressTimeline } from "../utils/session-fixture"
import { fileNode } from "../utils/workspace"

test.use({ viewport: { width: 390, height: 844 } })

async function openFiles(page: Page) {
  await page
    .getByRole("tablist", { name: "Session view", exact: true })
    .getByRole("tab", { name: "More...", exact: true })
    .click()
  await page
    .getByRole("dialog", { name: "More options", exact: true })
    .getByRole("button", { name: "Files", exact: true })
    .click()
}

test("mobile files browse, comment, search, and close tabs", async ({ page }) => {
  await mockStressTimeline(page, {
    fileList: (path) => (path ? [] : ["first.ts", "second.ts"].map((name) => fileNode(fixture.directory, name))),
    fileContent: (path) => `contents:${path}`,
    findFiles: ({ query }) =>
      ["first.ts", "second.ts"].flatMap((path) => (path.includes(query) ? [fileNode(fixture.directory, path)] : [])),
  })
  await page.goto(sessionHref(fixture.targetID))
  const navigation = page.getByRole("tablist", { name: "Session view", exact: true })
  await openFiles(page)
  const files = page.locator('[data-slot="session-mobile-files"]')
  await files.getByRole("button", { name: "first.ts", exact: true }).click()
  await expect(files.getByText("contents:first.ts", { exact: true })).toBeVisible()
  await files.locator('[data-column-number="1"]').click()
  const editor = files.locator('[data-component="line-comment-v2"][data-variant="editor"]')
  await expect(editor.getByRole("textbox")).toBeVisible()

  const fullWidth = async (card: typeof editor) => {
    const panel = (await files.boundingBox())!
    const box = await card.boundingBox()

    return !!box && Math.abs(box.x - panel.x - 12) < 2 && Math.abs(box.width - panel.width + 24) < 2
  }

  for (const width of [390, 700]) {
    await page.setViewportSize({ width, height: 844 })
    await expect.poll(() => fullWidth(editor)).toBe(true)
  }

  await editor.getByRole("textbox").fill("Full-width file comment")
  await editor.getByRole("button", { name: "Comment", exact: true }).click()
  const comment = files.locator('[data-component="line-comment-v2"][data-variant="display"]')
  await expect(comment).toContainText("Full-width file comment")
  await expect.poll(() => fullWidth(comment)).toBe(true)

  await page.setViewportSize({ width: 390, height: 844 })
  // Its composer chip reveals the comment without leaving the conversation.
  const session = navigation.getByRole("tab", { name: "Session", exact: true })
  await session.click()
  await page
    .locator('[data-component="composer-attachments"]')
    .getByText("Full-width file comment", { exact: true })
    .click()
  await expect(session).toHaveAttribute("aria-selected", "true")
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeVisible()
  await openFiles(page)
  await expect(files.getByText("contents:first.ts", { exact: true })).toBeVisible()
  const filter = files.getByRole("combobox", { name: "Filter files", exact: true })
  await expect(filter).toBeHidden()
  await files.getByRole("button", { name: "All files", exact: true }).click()
  await filter.fill("second")
  await files.getByRole("option", { name: "second.ts", exact: true }).click()
  await expect(files.getByText("contents:second.ts", { exact: true })).toBeVisible()
  const openTabs = files.getByRole("tablist", { name: "Open files", exact: true })
  await expect(openTabs.getByRole("tab")).toHaveText(["first.ts", "second.ts"])
  await openTabs.getByRole("tab", { name: "first.ts", exact: true }).click()
  await expect(files.getByText("contents:first.ts", { exact: true })).toBeVisible()
  await navigation.getByRole("tab", { name: "Session", exact: true }).click()
  await openFiles(page)
  await expect(files.getByText("contents:first.ts", { exact: true })).toBeVisible()
  await files
    .locator('[data-slot="tabs-v2-trigger-wrapper"]')
    .filter({ has: page.getByRole("tab", { name: "first.ts", exact: true }) })
    .getByRole("button", { name: "Close tab", exact: true })
    .click()
  await expect(openTabs.getByRole("tab")).toHaveText(["second.ts"])
  await expect(files.getByText("contents:second.ts", { exact: true })).toBeVisible()
  await files.getByRole("button", { name: "Close tab", exact: true }).click()
  await expect(filter).toBeVisible()
  await expect(openTabs.getByRole("tab")).toHaveCount(0)
})

test("mobile changes summarize expanded diffs, stage comments, wrap by setting, and open files", async ({ page }) => {
  const held = Promise.withResolvers<void>()
  await mockStressTimeline(page, {
    vcsDiff: [
      {
        file: "added.ts",
        status: "added",
        additions: 1,
        deletions: 0,
        patch:
          "diff --git a/added.ts b/added.ts\n--- /dev/null\n+++ b/added.ts\n@@ -0,0 +1 @@\n+export const added = 1\n",
      },
      {
        file: "removed.ts",
        status: "deleted",
        additions: 0,
        deletions: 1,
        patch:
          "diff --git a/removed.ts b/removed.ts\n--- a/removed.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-export const removed = 1\n",
      },
      {
        file: "modified.ts",
        status: "modified",
        additions: 1,
        deletions: 1,
        patch: `diff --git a/modified.ts b/modified.ts\n--- a/modified.ts\n+++ b/modified.ts\n@@ -1 +1 @@\n-export const value = 1\n+export const value = "${"long content ".repeat(30)}"\n`,
      },
      {
        file: "src/review.ts",
        status: "modified",
        additions: 1,
        deletions: 1,
        patch:
          "diff --git a/src/review.ts b/src/review.ts\n--- a/src/review.ts\n+++ b/src/review.ts\n@@ -1,3 +1,3 @@\n export const first = 1\n-export const value = 'before'\n+export const value = 'after'\n export const last = 3\n",
      },
    ],
    fileContent: async (path) => {
      if (path === "modified.ts") await held.promise

      return `contents:${path}`
    },
  })
  await page.goto(sessionHref(fixture.targetID))
  const navigation = page.getByRole("tablist", { name: "Session view", exact: true })
  const files = page.locator('[data-slot="session-mobile-files"]')
  await navigation.getByRole("tab", { name: "Changes", exact: true }).click()
  const review = page.locator('[data-component="session-review"]')
  await expect(review.getByRole("button", { name: "Expand all", exact: true })).toBeVisible()
  await page.evaluate(() => (document.documentElement.dir = "rtl"))

  for (const change of [
    { file: "added.ts", status: "Added", additions: "+1", deletions: "-0" },
    { file: "removed.ts", status: "Removed", additions: "+0", deletions: "-1" },
    { file: "modified.ts", status: undefined, additions: "+1", deletions: "-1" },
  ]) {
    const item = review.locator(`[data-file="${change.file}"]`)
    const trigger = item.getByRole("button", { name: change.file, exact: true })
    const summary = item.locator('[data-slot="session-review-change-summary"]')
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await expect(trigger.locator('[data-component="diff-changes"]')).toHaveCount(0)
    await expect(trigger.locator('[data-slot="session-review-change"]')).toHaveCount(0)
    await expect(summary).toHaveCount(0)
    await trigger.click()
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    await expect(summary.getByRole("button", { name: "Open file", exact: true })).toBeVisible()
    await expect(summary.locator('[data-slot="diff-changes-additions"]')).toHaveText(change.additions)
    await expect(summary.locator('[data-slot="diff-changes-deletions"]')).toHaveText(change.deletions)

    if (change.status) await expect(summary.getByText(change.status, { exact: true })).toBeVisible()
    await trigger.click()
    await expect(trigger).toHaveAttribute("aria-expanded", "false")
    await expect(summary).toHaveCount(0)
  }

  await expect(review.locator('[data-slot="session-review-view-button"]')).toHaveCount(0)
  const modified = review.locator('[data-file="modified.ts"]')
  await modified.getByRole("button", { name: "modified.ts", exact: true }).click()
  await expect(modified.locator("[data-line-number-content]")).toHaveText(["1", "1"])
  await expect(modified.locator("[data-diff]")).not.toHaveAttribute("data-disable-line-numbers")
  await expect(modified.locator("[data-diff]")).toHaveAttribute("data-overflow", "wrap")
  await expect(review.getByRole("button", { name: "Diff options", exact: true })).toHaveCount(0)

  // A line comment is staged into the composer context without writing anything to the server.
  const writes: string[] = []

  const recordWrite = (request: Request) => {
    if (request.method() !== "GET") writes.push(`${request.method()} ${new URL(request.url()).pathname}`)
  }

  page.on("request", recordWrite)
  const note = "Use the existing value instead"
  const commented = review.locator('[data-file="src/review.ts"]')
  await commented.getByRole("button", { expanded: false }).click()
  await commented.getByText("export const value = 'after'", { exact: true }).click()
  await expect(commented.locator('[data-slot="line-comment-editor-label"]')).toHaveText("Commenting on line 2")
  await commented.getByRole("textbox").fill(note)
  await commented.locator('[data-slot="line-comment-action"][data-variant="primary"]').click()
  await expect(commented.getByText(note, { exact: true })).toBeVisible()
  await navigation.getByRole("tab", { name: "Session", exact: true }).click()
  const attachments = page.locator('[data-component="composer-attachments"]')
  await expect(attachments.getByText(note, { exact: true })).toBeVisible()
  await expect(attachments).toContainText("review.ts:2")
  page.off("request", recordWrite)
  expect(writes).toEqual([])

  await page.keyboard.press("Control+,")
  const settings = page.getByTestId("settings-screen")
  const wrap = settings.getByRole("switch", { name: "Wrap lines", exact: true })
  const wrapControl = settings.locator('[data-action="settings-mobile-diff-wrap"] [data-slot="switch-control"]')

  const storedWrap = () =>
    page.evaluate(
      () => JSON.parse(localStorage.getItem("opencode.global.dat:extension.review.mobileDiff") ?? "{}").wrap,
    )

  await expect(wrap).toBeChecked()
  await wrapControl.click()
  await expect(wrap).not.toBeChecked()
  await expect.poll(storedWrap).toBe(false)
  await settings.getByRole("button", { name: "Back to app", exact: true }).click()
  await expect(page).toHaveURL(sessionHref(fixture.targetID))
  await navigation.getByRole("tab", { name: "Changes", exact: true }).click()
  await expect(modified.locator("[data-diff]")).toHaveAttribute("data-overflow", "scroll")
  await expect
    .poll(() => modified.locator("[data-code]").evaluate((element) => element.scrollWidth > element.clientWidth))
    .toBe(true)
  await modified.locator("[data-code]").evaluate((element) => {
    element.scrollLeft = 100
  })
  await expect
    .poll(() => modified.locator("[data-code]").evaluate((element) => Math.abs(element.scrollLeft)))
    .toBeGreaterThan(0)
  await navigation.getByRole("tab", { name: "Session", exact: true }).click()
  await navigation.getByRole("tab", { name: "Changes", exact: true }).click()
  await expect(modified.locator("[data-diff]")).toHaveAttribute("data-overflow", "scroll")
  await page.keyboard.press("Control+,")
  await expect(wrap).not.toBeChecked()
  await wrapControl.click()
  await expect(wrap).toBeChecked()
  await expect.poll(storedWrap).toBe(true)
  await settings.getByRole("button", { name: "Back to app", exact: true }).click()
  await expect(page).toHaveURL(sessionHref(fixture.targetID))
  await navigation.getByRole("tab", { name: "Changes", exact: true }).click()
  await expect(modified.locator("[data-diff]")).toHaveAttribute("data-overflow", "wrap")

  const openFile = modified.getByRole("button", { name: "Open file", exact: true })
  await expect
    .poll(async () => {
      const button = (await openFile.boundingBox())!
      const summary = (await modified.locator('[data-slot="session-review-change-summary"]').boundingBox())!

      return button.x + button.width < summary.x + summary.width / 2
    })
    .toBe(true)

  // Opening a changed file selects its tab at once, before a slower file finishes loading; reopening switches back.
  await review.locator('[data-file="added.ts"]').getByRole("button", { name: "added.ts", exact: true }).click()
  const selected = files.getByRole("tablist", { name: "Open files", exact: true }).getByRole("tab", { selected: true })

  for (const file of ["added.ts", "modified.ts", "added.ts", "modified.ts"]) {
    await navigation.getByRole("tab", { name: "Changes", exact: true }).click()
    await review.locator(`[data-file="${file}"]`).getByRole("button", { name: "Open file", exact: true }).click()
    await expect(navigation.getByRole("tab", { name: "More...", exact: true })).toHaveAttribute("aria-selected", "true")
    await expect(selected).toHaveText([file])
    await expect(files).toHaveAttribute("data-browsing", "false")

    if (file === "modified.ts") held.resolve()
    await expect(files.getByText(`contents:${file}`, { exact: true })).toBeVisible()
  }
})

test("summary drawer dismisses by backdrop, Escape, and drag", async ({ page }) => {
  await mockStressTimeline(page)
  await page.goto(sessionHref(fixture.targetID))

  const more = page
    .getByRole("tablist", { name: "Session view", exact: true })
    .getByRole("tab", { name: "More...", exact: true })

  const drawer = page.getByRole("dialog", { name: "Session details", exact: true })
  const overlay = page.locator('[data-slot="mobile-drawer-overlay"]')

  for (const dismissal of ["backdrop", "escape", "drag"] as const) {
    await more.click()
    await page
      .getByRole("dialog", { name: "More options", exact: true })
      .getByRole("button", { name: "Session details", exact: true })
      .click()
    await expect(drawer.getByRole("button", { name: "MCP", exact: true })).toBeVisible()
    // Corvu starts opening after paint; the transition flag is also absent
    // before that callback. Wait for the open position before dismissing.
    await expect
      .poll(() => drawer.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m42))
      .toBe(0)
    await expect(drawer).not.toHaveAttribute("data-transitioning")

    if (dismissal === "backdrop") await overlay.click({ position: { x: 10, y: 10 } })

    if (dismissal === "escape") await page.keyboard.press("Escape")

    if (dismissal === "drag") {
      const bounds = (await drawer.locator('[data-slot="mobile-drawer-handle"]').boundingBox())!
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      await page.mouse.down()
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 + 1)
      await page.mouse.move(bounds.x + bounds.width / 2, 843)
      await page.mouse.up()
    }

    await expect(drawer, `dismissal: ${dismissal}`).toBeHidden()
    await expect(overlay).toHaveCount(0)
    await expect(more).toBeFocused()
  }
})
