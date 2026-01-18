import { test, expect } from "@playwright/test"

test("home renders and shows an open project entrypoint", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByText("Recent projects").or(page.getByText("No recent projects"))).toBeVisible()
  await expect(page.getByRole("button", { name: "Open project" }).first()).toBeVisible()
})

test("server picker dialog opens from home", async ({ page }) => {
  const host = process.env.PLAYWRIGHT_SERVER_HOST ?? "localhost"
  const port = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
  const name = `${host}:${port}`

  await page.goto("/")

  const trigger = page.getByRole("button", { name })
  await expect(trigger).toBeVisible()
  await trigger.click()

  const dialog = page.getByRole("dialog", { name: "Servers" })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByPlaceholder("Search servers")).toBeVisible()
})
