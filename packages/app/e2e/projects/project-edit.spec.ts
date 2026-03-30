import { test, expect } from "../fixtures"
import { clickMenuItem, openProjectMenu, openSidebar } from "../actions"

test("dialog edit project updates name and startup script", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  await withProject(async ({ slug }) => {
    await openSidebar(page)

    const open = async () => {
      const menu = await openProjectMenu(page, slug)
      await clickMenuItem(menu, /^Edit$/i, { force: true })

      const dialog = page.getByRole("dialog")
      await expect(dialog).toBeVisible()
      await expect(dialog.getByRole("heading", { level: 2 })).toHaveText("Edit project")
      return dialog
    }

    const name = `e2e project ${Date.now()}`
    const startup = `echo e2e_${Date.now()}`

    const dialog = await open()

    const nameInput = dialog.getByLabel("Name")
    await nameInput.fill(name)

    const startupInput = dialog.getByLabel("Workspace startup script")
    await startupInput.fill(startup)

    await dialog.getByRole("button", { name: "Save" }).click()
    await expect(dialog).toHaveCount(0)

    const header = page.locator(".group\\/project").first()
    await expect(header).toContainText(name)

    const reopened = await open()
    await expect(reopened.getByLabel("Name")).toHaveValue(name)
    await expect(reopened.getByLabel("Workspace startup script")).toHaveValue(startup)
    await reopened.getByRole("button", { name: "Cancel" }).click()
    await expect(reopened).toHaveCount(0)
  })
})
