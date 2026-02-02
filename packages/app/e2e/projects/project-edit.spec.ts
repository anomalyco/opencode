import { test, expect } from "../fixtures"
import { openSidebar } from "../actions"

test("dialog edit project updates name and startup script", async ({ page, gotoSession }) => {
  await gotoSession()
  await page.setViewportSize({ width: 1400, height: 800 })

  await openSidebar(page)

  const open = async () => {
    const header = page.locator(".group\\/project").first()
    await header.hover()
    const trigger = header.getByRole("button", { name: "More options" }).first()
    await expect(trigger).toBeVisible()
    await trigger.click({ force: true })

    const menu = page.locator('[data-component="dropdown-menu-content"]').first()
    await expect(menu).toBeVisible()

    const editItem = menu.getByRole("menuitem", { name: "Edit" }).first()
    await expect(editItem).toBeVisible()
    await editItem.click({ force: true })

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
