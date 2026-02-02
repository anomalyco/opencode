import { test, expect } from "../fixtures"
import { createTestProject, seedProjects, cleanupTestProject, openSidebar, clickMenuItem } from "../actions"
import { projectCloseHoverSelector, projectCloseMenuSelector, projectSwitchSelector } from "../selectors"
import { dirSlug } from "../utils"

test("can close a project via hover card close button", async ({ page, directory, gotoSession }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const other = await createTestProject()
  const otherSlug = dirSlug(other)
  await seedProjects(page, { directory, extra: [other] })

  try {
    await gotoSession()

    await openSidebar(page)

    const otherButton = page.locator(projectSwitchSelector(otherSlug)).first()
    await expect(otherButton).toBeVisible()
    await otherButton.hover()

    const close = page.locator(projectCloseHoverSelector(otherSlug)).first()
    await expect(close).toBeVisible()
    await close.click()

    await expect(otherButton).toHaveCount(0)
  } finally {
    await cleanupTestProject(other)
  }
})

test("can close a project via project header more options menu", async ({ page, directory, gotoSession }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const other = await createTestProject()
  const otherName = other.split("/").pop() ?? other
  const otherSlug = dirSlug(other)
  await seedProjects(page, { directory, extra: [other] })

  try {
    await gotoSession()

    await openSidebar(page)

    const otherButton = page.locator(projectSwitchSelector(otherSlug)).first()
    await expect(otherButton).toBeVisible()
    await otherButton.click()

    await expect(page).toHaveURL(new RegExp(`/${otherSlug}/session`))

    const header = page
      .locator(".group\\/project")
      .filter({ has: page.locator(`[data-action="project-menu"][data-project="${otherSlug}"]`) })
      .first()
    await expect(header).toContainText(otherName)

    const trigger = header.locator(`[data-action="project-menu"][data-project="${otherSlug}"]`).first()
    await expect(trigger).toHaveCount(1)
    await trigger.focus()
    await page.keyboard.press("Enter")

    const menu = page.locator('[data-component="dropdown-menu-content"]').first()
    await expect(menu).toBeVisible({ timeout: 10_000 })

    await clickMenuItem(menu, /^Close$/i, { force: true })
    await expect(otherButton).toHaveCount(0)
  } finally {
    await cleanupTestProject(other)
  }
})
