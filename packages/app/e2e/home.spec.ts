import { test, expect } from "./fixtures"
import { serverName } from "./utils"

test("home renders and shows core entrypoints", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByRole("button", { name: "Open project" }).first()).toBeVisible()
  await expect(page.getByRole("button", { name: serverName })).toBeVisible()
})

test("server picker dialog opens from home", async ({ page }) => {
  await page.goto("/")

  const trigger = page.getByRole("button", { name: serverName })
  await expect(trigger).toBeVisible()
  await trigger.click()

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("textbox").first()).toBeVisible()
})
