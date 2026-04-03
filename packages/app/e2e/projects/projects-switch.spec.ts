import { base64Decode } from "@opencode-ai/util/encode"
import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import {
  clickListItem,
  defocus,
  createTestProject,
  cleanupTestProject,
  openSidebar,
  setWorkspacesEnabled,
  waitSession,
  waitSlug,
} from "../actions"
import { projectSwitchSelector, workspaceItemSelector, workspaceNewSessionSelector } from "../selectors"
import { dirSlug, resolveDirectory } from "../utils"

async function reopen(page: Page, directory: string) {
  await openSidebar(page)
  const trigger = page.getByRole("button", { name: "Open project" }).first()
  await expect(trigger).toBeVisible()
  await trigger.click()

  const dialog = page.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await clickListItem(dialog, { key: directory })
  await expect(dialog).toHaveCount(0)
}

test("can switch between projects from sidebar", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const other = await createTestProject()
  const otherSlug = dirSlug(other)

  try {
    await project.open({ extra: [other] })
    await defocus(page)

    const currentSlug = dirSlug(project.directory)
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

test("switching back to a project opens the latest workspace session", async ({ page, project }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const other = await createTestProject()
  const otherSlug = dirSlug(other)
  try {
    await project.open({ extra: [other] })
    await defocus(page)
    await setWorkspacesEnabled(page, project.slug, true)
    await openSidebar(page)
    await expect(page.getByRole("button", { name: "New workspace" }).first()).toBeVisible()

    await page.getByRole("button", { name: "New workspace" }).first().click()

    const raw = await waitSlug(page, [project.slug])
    const dir = base64Decode(raw)
    if (!dir) throw new Error(`Failed to decode workspace slug: ${raw}`)
    const space = await resolveDirectory(dir)
    const next = dirSlug(space)
    project.trackDirectory(space)
    await openSidebar(page)

    const item = page.locator(`${workspaceItemSelector(next)}, ${workspaceItemSelector(raw)}`).first()
    await expect(item).toBeVisible()
    await item.hover()

    const btn = page.locator(`${workspaceNewSessionSelector(next)}, ${workspaceNewSessionSelector(raw)}`).first()
    await expect(btn).toBeVisible()
    await btn.click({ force: true })

    await waitSession(page, { directory: space })

    const created = await project.user("test")

    await expect(page).toHaveURL(new RegExp(`/${next}/session/${created}(?:[/?#]|$)`))

    await openSidebar(page)

    const otherButton = page.locator(projectSwitchSelector(otherSlug)).first()
    await expect(otherButton).toBeVisible()
    await otherButton.click({ force: true })
    await waitSession(page, { directory: other })

    const rootButton = page.locator(projectSwitchSelector(project.slug)).first()
    await expect(rootButton).toBeVisible()
    await rootButton.click({ force: true })

    await waitSession(page, { directory: space, sessionID: created })
    await expect(page).toHaveURL(new RegExp(`/session/${created}(?:[/?#]|$)`))
  } finally {
    await cleanupTestProject(other)
  }
})

test("reopening the current project from picker opens a fresh session view", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  await withProject(async ({ directory, trackSession }) => {
    await defocus(page)

    const prompt = page.locator(promptSelector)
    await expect(prompt).toBeVisible()
    await prompt.fill("test")
    await page.keyboard.press("Enter")

    await expect.poll(() => sessionIDFromUrl(page.url()) ?? "", { timeout: 15_000 }).not.toBe("")

    const created = sessionIDFromUrl(page.url())
    if (!created) throw new Error(`Failed to get session ID from url: ${page.url()}`)
    trackSession(created, directory)
    await waitSessionSaved(directory, created)

    await reopen(page, directory)

    await waitSession(page, { directory })
    await expect.poll(() => sessionIDFromUrl(page.url())).toBe("")
  })
})

test("reopening another open project from picker opens a fresh session view", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const other = await createTestProject()
  const otherSlug = dirSlug(other)

  try {
    await withProject(
      async ({ directory, slug, trackSession }) => {
        await defocus(page)

        const prompt = page.locator(promptSelector)
        await expect(prompt).toBeVisible()
        await prompt.fill("test")
        await page.keyboard.press("Enter")

        await expect.poll(() => sessionIDFromUrl(page.url()) ?? "", { timeout: 15_000 }).not.toBe("")

        const created = sessionIDFromUrl(page.url())
        if (!created) throw new Error(`Failed to get session ID from url: ${page.url()}`)
        trackSession(created, directory)
        await waitSessionSaved(directory, created)

        await openSidebar(page)

        const otherButton = page.locator(projectSwitchSelector(otherSlug)).first()
        await expect(otherButton).toBeVisible()
        await otherButton.click({ force: true })
        await waitSession(page, { directory: other })

        await reopen(page, directory)

        await waitSession(page, { directory })
        await expect(page).toHaveURL(new RegExp(`/${slug}/session(?:[/?#]|$)`))
        await expect.poll(() => sessionIDFromUrl(page.url())).toBe("")
      },
      { extra: [other] },
    )
  } finally {
    await cleanupTestProject(other)
  }
})
