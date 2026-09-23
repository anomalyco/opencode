import { expect, test } from "@playwright/test"
import { fixture } from "../performance/timeline/session-timeline-stress.fixture"
import { mockStressTimeline, stressSessionHref } from "../performance/timeline/timeline-test-helpers"

for (const direction of ["ltr", "rtl"] as const) {
  test(`mobile change summaries appear only for expanded diffs in ${direction}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
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
      ],
    })
    await page.goto(stressSessionHref(fixture.targetID))
    await page.getByRole("tab", { name: "Changes", exact: true }).click()
    const review = page.locator('[data-component="session-review"]')
    await expect(review.getByRole("button", { name: "Expand all", exact: true })).toBeVisible()
    await page.evaluate((direction) => (document.documentElement.dir = direction), direction)

    await expect(review.locator('[data-file="added.ts"] [data-slot="accordion-trigger"]')).toHaveCSS(
      "border-top-width",
      "0px",
    )
    await expect(review.locator('[data-file="modified.ts"] [data-slot="accordion-trigger"]')).toHaveCSS(
      "border-bottom-width",
      "0px",
    )

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
      if (change.file === "modified.ts") {
        await expect(item.locator('[data-slot="accordion-content"]')).toHaveCSS("border-bottom-width", "0px")
        await expect(trigger).not.toHaveCSS("border-bottom-width", "0px")
      }
      await expect(summary).toBeVisible()
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
    await page.keyboard.press("Control+,")
    const settings = page.getByTestId("settings-screen")
    const wrap = settings.getByRole("switch", { name: "Wrap lines", exact: true })
    const wrapControl = settings.locator('[data-action="settings-mobile-diff-wrap"] [data-slot="switch-control"]')
    await expect(wrap).toBeChecked()
    await wrapControl.click()
    await expect(wrap).not.toBeChecked()
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("settings.v3") ?? "{}").general?.mobileDiffWrap))
      .toBe(false)
    await settings.getByRole("button", { name: "Back to app", exact: true }).click()
    await expect(page).toHaveURL(stressSessionHref(fixture.targetID))
    await page.getByRole("tab", { name: "Changes", exact: true }).click()
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
    const navigation = page.getByRole("tablist", { name: "Session view", exact: true })
    await navigation.getByRole("tab", { name: "Session", exact: true }).click()
    await navigation.getByRole("tab", { name: "Changes", exact: true }).click()
    await expect(modified.locator("[data-diff]")).toHaveAttribute("data-overflow", "scroll")
    await page.keyboard.press("Control+,")
    await expect(wrap).not.toBeChecked()
    await wrapControl.click()
    await expect(wrap).toBeChecked()
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("settings.v3") ?? "{}").general?.mobileDiffWrap))
      .toBe(true)
    await settings.getByRole("button", { name: "Back to app", exact: true }).click()
    await expect(page).toHaveURL(stressSessionHref(fixture.targetID))
    await navigation.getByRole("tab", { name: "Changes", exact: true }).click()
    await expect(modified.locator("[data-diff]")).toHaveAttribute("data-overflow", "wrap")
    const openFile = modified.getByRole("button", { name: "Open file", exact: true })
    await expect(openFile).toBeVisible()
    await expect
      .poll(async () => {
        const button = await openFile.boundingBox()
        const summary = await modified.locator('[data-slot="session-review-change-summary"]').boundingBox()
        if (!button || !summary) return false
        return direction === "ltr"
          ? button.x > summary.x + summary.width / 2
          : button.x + button.width < summary.x + summary.width / 2
      })
      .toBe(true)
    await openFile.click()
    await expect(
      page.getByRole("tablist", { name: "Session view", exact: true }).getByRole("tab", { name: "Files", exact: true }),
    ).toHaveAttribute("aria-selected", "true")
    const files = page.locator('[data-slot="session-mobile-files"]')
    await expect(files.getByRole("tab", { name: "modified.ts", exact: true })).toHaveAttribute("aria-selected", "true")
    await expect(files).toHaveAttribute("data-browsing", "false")
  })
}
