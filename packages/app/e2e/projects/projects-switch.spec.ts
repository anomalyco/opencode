import { base64Decode } from "@opencode-ai/util/encode"
import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import {
  defocus,
  createTestProject,
  cleanupTestProject,
  openSidebar,
  sessionIDFromUrl,
  waitDir,
  waitSlug,
} from "../actions"
import { projectSwitchSelector, promptSelector, workspaceItemSelector, workspaceNewSessionSelector } from "../selectors"
import { dirSlug, resolveDirectory } from "../utils"

async function workspaces(page: Page, directory: string, enabled: boolean) {
  await page.evaluate(
    ({ directory, enabled }: { directory: string; enabled: boolean }) => {
      const key = "opencode.global.dat:layout"
      const raw = localStorage.getItem(key)
      const data = raw ? JSON.parse(raw) : {}
      const sidebar = data.sidebar && typeof data.sidebar === "object" ? data.sidebar : {}
      const current =
        sidebar.workspaces && typeof sidebar.workspaces === "object" && !Array.isArray(sidebar.workspaces)
          ? sidebar.workspaces
          : {}
      const next = { ...current }

      if (enabled) next[directory] = true
      if (!enabled) delete next[directory]

      localStorage.setItem(
        key,
        JSON.stringify({
          ...data,
          sidebar: {
            ...sidebar,
            workspaces: next,
          },
        }),
      )
    },
    { directory, enabled },
  )
}

test("can switch between projects from sidebar", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const other = await createTestProject()
  const otherSlug = dirSlug(other)

  try {
    await withProject(
      async ({ directory }) => {
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
      },
      { extra: [other] },
    )
  } finally {
    await cleanupTestProject(other)
  }
})

test("switching back to a project opens the latest workspace session", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  const other = await createTestProject()
  const otherSlug = dirSlug(other)
  try {
    await withProject(
      async ({ directory, slug, trackSession, trackDirectory }) => {
        await defocus(page)
        await workspaces(page, directory, true)
        await page.reload()
        await expect(page.locator(promptSelector)).toBeVisible()
        await openSidebar(page)
        await expect(page.getByRole("button", { name: "New workspace" }).first()).toBeVisible()

        await page.getByRole("button", { name: "New workspace" }).first().click()

        const raw = await waitSlug(page, [slug])
        const dir = base64Decode(raw)
        if (!dir) throw new Error(`Failed to decode workspace slug: ${raw}`)
        const space = await resolveDirectory(dir)
        const next = dirSlug(space)
        trackDirectory(space)
        await openSidebar(page)

        const item = page.locator(`${workspaceItemSelector(next)}, ${workspaceItemSelector(raw)}`).first()
        await expect(item).toBeVisible()
        await item.hover()

        const btn = page.locator(`${workspaceNewSessionSelector(next)}, ${workspaceNewSessionSelector(raw)}`).first()
        await expect(btn).toBeVisible()
        await btn.click({ force: true })

        await waitSlug(page)
        await waitDir(page, space)

        // Create a session by sending a prompt
        const prompt = page.locator(promptSelector)
        await expect(prompt).toBeVisible()
        await prompt.fill("test")
        await page.keyboard.press("Enter")

        // Wait for the URL to update with the new session ID
        await expect.poll(() => sessionIDFromUrl(page.url()) ?? "", { timeout: 15_000 }).not.toBe("")

        const created = sessionIDFromUrl(page.url())
        if (!created) throw new Error(`Failed to get session ID from url: ${page.url()}`)
        trackSession(created, space)

        await expect(page).toHaveURL(new RegExp(`/${next}/session/${created}(?:[/?#]|$)`))

        await openSidebar(page)

        const otherButton = page.locator(projectSwitchSelector(otherSlug)).first()
        await expect(otherButton).toBeVisible()
        await otherButton.click()
        await expect(page).toHaveURL(new RegExp(`/${otherSlug}/session`))

        const rootButton = page.locator(projectSwitchSelector(slug)).first()
        await expect(rootButton).toBeVisible()
        await rootButton.click()

        await waitDir(page, space)
        await expect.poll(() => sessionIDFromUrl(page.url()) ?? "").toBe(created)
        await expect(page).toHaveURL(new RegExp(`/session/${created}(?:[/?#]|$)`))
      },
      { extra: [other] },
    )
  } finally {
    await cleanupTestProject(other)
  }
})
