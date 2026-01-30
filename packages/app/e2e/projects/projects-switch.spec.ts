import { test, expect } from "../fixtures"
import { defocus, createTestProject, seedProjects, cleanupTestProject } from "../actions"
import { projectSwitchSelector } from "../selectors"
import { dirSlug } from "../utils"

test("can switch between projects from sidebar", async ({ page, directory, gotoSession }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const other = await createTestProject()
  const otherSlug = dirSlug(other)

  await seedProjects(page, { directory, extra: [other] })

  try {
    await gotoSession()

    await defocus(page)

    const currentSlug = dirSlug(directory)
    const otherButton = page.locator(projectSwitchSelector(otherSlug)).first()
    await expect(otherButton).toBeVisible()
    await otherButton.click()

    await expect(page).toHaveURL(new RegExp(`/${otherSlug}/session`))

    const currentButton = page.locator(projectSwitchSelector(currentSlug)).first()
    await expect(currentButton).toBeVisible()
    await currentButton.click()

    await expect(page).toHaveURL(new RegExp(`/${currentSlug}/session`))
  } finally {
    await cleanupTestProject(other)
  }
})
