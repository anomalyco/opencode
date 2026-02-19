import { test, expect } from "../fixtures"
import { createTestProject, cleanupTestProject, openSidebar, clickMenuItem, openProjectMenu } from "../actions"
import { projectCloseHoverSelector, projectSwitchSelector } from "../selectors"
import { dirSlug } from "../utils"

test("can close a project via hover card close button", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const other = await createTestProject()
  const otherSlug = dirSlug(other)

  try {
    await withProject(
      async () => {
        await openSidebar(page)

        const otherButton = page.locator(projectSwitchSelector(otherSlug)).first()
        await expect(otherButton).toBeVisible()
        await otherButton.hover()

        const close = page.locator(projectCloseHoverSelector(otherSlug)).first()
        await expect(close).toBeVisible()
        await close.click()

        await expect(otherButton).toHaveCount(0)
      },
      { extra: [other] },
    )
  } finally {
    await cleanupTestProject(other)
  }
})

test("closing active project navigates to another open project", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const other = await createTestProject()
  const otherSlug = dirSlug(other)

  try {
    await withProject(
      async ({ slug }) => {
        await openSidebar(page)

        const otherButton = page.locator(projectSwitchSelector(otherSlug)).first()
        await expect(otherButton).toBeVisible()
        await otherButton.click()

        await expect(page).toHaveURL(new RegExp(`/${otherSlug}/session`))

        const menu = await openProjectMenu(page, otherSlug)

        await clickMenuItem(menu, /^Close$/i, { force: true })

        await expect
          .poll(() => {
            const pathname = new URL(page.url()).pathname
            if (new RegExp(`^/${slug}/session(?:/[^/]+)?/?$`).test(pathname)) return "project"
            if (pathname === "/") return "home"
            return ""
          })
          .toMatch(/^(project|home)$/)

        await expect(page).not.toHaveURL(new RegExp(`/${otherSlug}/session(?:[/?#]|$)`))
        await expect(otherButton).toHaveCount(0)
      },
      { extra: [other] },
    )
  } finally {
    await cleanupTestProject(other)
  }
})
