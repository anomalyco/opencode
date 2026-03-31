import { test, expect } from "../fixtures"
import { serverNamePattern } from "../utils"

test("home renders and shows core entrypoints", async ({ page }) => {
  await page.goto("/")
  const nav = page.locator('[data-component="sidebar-nav-desktop"]')

  await expect(page.getByRole("button", { name: "Open project" }).first()).toBeVisible()
  // New sidebar shows "Threads" header instead of "No projects open" text
  await expect(nav.getByText("Threads")).toBeVisible()
  await expect(page.getByRole("button", { name: serverNamePattern })).toBeVisible()
})

test("server picker dialog opens from home", async ({ page }) => {
  await page.goto("/")

  const trigger = page.getByRole("button", { name: serverNamePattern })
  await expect(trigger).toBeVisible()
  await trigger.click()

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("textbox").first()).toBeVisible()
})
