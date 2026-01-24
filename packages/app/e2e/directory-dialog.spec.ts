import { test, expect } from "./fixtures"

test("open project dialog shows directories when searching ~", async ({ page }) => {
  // Clear localStorage to ensure fresh state
  await page.addInitScript(() => {
    localStorage.clear()
  })

  await page.goto("/")

  // Wait for the home page to load
  const openProjectButton = page.getByRole("button", { name: "Open project" }).first()
  await expect(openProjectButton).toBeVisible({ timeout: 10000 })

  // Click the open project button
  await openProjectButton.click()

  // Wait for the dialog to appear
  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()

  // Find the search input and type ~
  const searchInput = dialog.getByRole("textbox")
  await expect(searchInput).toBeVisible()
  await searchInput.fill("~")

  // Wait for directories to load - should NOT show "No folders found"
  await page.waitForTimeout(2000) // Allow time for API request

  // Check that we don't see "No folders found"
  const noFolders = dialog.getByText("No folders found")
  const hasFolders = (await noFolders.count()) === 0

  if (!hasFolders) {
    // Log network requests for debugging
    console.log("No folders found - checking network")
  }

  // We should see some directories from the home folder
  await expect(noFolders).not.toBeVisible({ timeout: 5000 })
})

test("open project dialog shows directories when empty search", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear()
  })

  await page.goto("/")

  const openProjectButton = page.getByRole("button", { name: "Open project" }).first()
  await expect(openProjectButton).toBeVisible({ timeout: 10000 })
  await openProjectButton.click()

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()

  // With empty search, should show directories
  await page.waitForTimeout(2000)

  const noFolders = dialog.getByText("No folders found")
  await expect(noFolders).not.toBeVisible({ timeout: 5000 })
})
