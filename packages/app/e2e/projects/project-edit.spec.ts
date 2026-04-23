import { test, expect } from "../fixtures"
import { clickMenuItem, openProjectMenu, openSidebar } from "../actions"

test("dialog edit project updates name and startup script", async ({ page, project }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  await project.open()
  await openSidebar(page)

  const open = async () => {
    const menu = await openProjectMenu(page, project.slug)
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

  await expect
    .poll(
      async () => {
        await page.reload()
        await openSidebar(page)
        const reopened = await open()
        const value = await reopened.getByLabel("Name").inputValue()
        const next = await reopened.getByLabel("Workspace startup script").inputValue()
        await reopened.getByRole("button", { name: "Cancel" }).click()
        await expect(reopened).toHaveCount(0)
        return `${value}\n${next}`
      },
      { timeout: 30_000 },
    )
    .toBe(`${name}\n${startup}`)
})
