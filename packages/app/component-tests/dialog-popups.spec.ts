import type { Page } from "@playwright/test"
import { expect, story } from "../../stories/playwright/story"

// Role queries skip aria-hidden content, so each popup is only found if assistive tech can reach it too. A modal dialog
// hides content added outside it a task and a frame after it mounts, so each check waits that long before looking.
const settled = (page: Page) =>
  page.evaluate(
    () => new Promise((resolve) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))),
  )

story.beforeEach(async ({ mount, page }) => {
  await mount("ui-dialog--with-popups")
  await expect(page.getByRole("dialog", { name: "Popups" })).toBeVisible()
})

story("a select opened from a dialog lists its options", async ({ page }) => {
  const trigger = page.getByRole("dialog").locator('[data-component="select-v2"]')
  await trigger.click()
  await expect(page.locator('[data-slot="select-v2-listbox"]')).toBeVisible()
  await settled(page)
  await expect(page.getByRole("option")).toHaveCount(3)
  await page.getByRole("option", { name: "Banana" }).click()
  await expect(trigger).toContainText("Banana")
})

story("a non-modal menu and its submenu opened from a dialog list their items", async ({ page }) => {
  await page.getByRole("dialog").getByRole("button", { name: "Actions" }).click()
  await expect(page.getByText("Rename", { exact: true })).toBeVisible()
  await settled(page)
  await expect(page.getByRole("menuitem", { name: "Rename" })).toBeVisible()
  await page.getByRole("menuitem", { name: "Move to" }).hover()
  await expect(page.getByText("Archive", { exact: true })).toBeVisible()
  await settled(page)
  await expect(page.getByRole("menuitem", { name: "Archive" })).toBeVisible()
})

story("a tooltip opened from a dialog is announced", async ({ page }) => {
  await page.getByRole("dialog").getByRole("button", { name: "Copy" }).hover()
  await expect(page.getByText("Copy the link")).toBeVisible()
  await settled(page)
  await expect(page.getByRole("tooltip", { name: "Copy the link" })).toBeVisible()
})

story("a toast shown from a dialog is announced", async ({ page }) => {
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click()
  await expect(page.getByText("Saved", { exact: true })).toBeVisible()
  await settled(page)
  await expect(page.getByRole("listitem").filter({ hasText: "Saved" })).toBeVisible()
})
