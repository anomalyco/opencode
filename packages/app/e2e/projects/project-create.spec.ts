import { test, expect } from "../fixtures"

test("new project appears in sidebar and is selected", async ({ page }) => {
  await page.goto("/")

  const name = `E2E Project ${Date.now()}`
  const created = page.waitForResponse(
    (response) => response.url().endsWith("/project/create") && response.request().method() === "POST",
  )

  await page.locator('[data-component="sidebar-rail"]').getByRole("button", { name: "New project" }).click()
  const dialog = page.getByRole("dialog").filter({ hasText: "Create a new project" })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel("Project name").fill(name)
  await dialog.getByRole("button", { name: "Create project" }).click()

  const payload = (await created).json() as Promise<{ project?: { id?: string } }>
  const projectID = (await payload).project?.id
  expect(projectID).toBeTruthy()

  await expect(page).toHaveURL(new RegExp(`/${projectID}/session(?:[/?#]|$)`))

  const tile = page.locator(`[data-action="project-switch"][data-project="${projectID}"]`)
  await expect(tile).toBeVisible()
  await expect(tile).toHaveAttribute("aria-label", name)
  await expect(tile).toHaveAttribute("aria-current", "page")
})
