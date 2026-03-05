import { base64Decode } from "@opencode-ai/util/encode"
import { test, expect } from "../fixtures"
import {
  defocus,
  createTestProject,
  cleanupTestProject,
  openSidebar,
  setWorkspacesEnabled,
  sessionIDFromUrl,
} from "../actions"
import { projectSwitchSelector, promptSelector, workspaceItemSelector, workspaceNewSessionSelector } from "../selectors"
import { createSdk, dirSlug, sessionPath } from "../utils"

function slugFromUrl(url: string) {
  return /\/([^/]+)\/session(?:\/|$)/.exec(url)?.[1] ?? ""
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
  let rootDir: string | undefined
  let workspaceDir: string | undefined
  let sessionID: string | undefined

  try {
    await withProject(
      async ({ directory, slug }) => {
        rootDir = directory
        await defocus(page)
        await openSidebar(page)
        await setWorkspacesEnabled(page, slug, true)

        await page.getByRole("button", { name: "New workspace" }).first().click()

        await expect
          .poll(
            () => {
              const next = slugFromUrl(page.url())
              if (!next) return ""
              if (next === slug) return ""
              return next
            },
            { timeout: 45_000 },
          )
          .not.toBe("")

        const workspaceSlug = slugFromUrl(page.url())
        workspaceDir = base64Decode(workspaceSlug)
        if (!workspaceDir) throw new Error(`Failed to decode workspace slug: ${workspaceSlug}`)
        await openSidebar(page)

        const workspace = page.locator(workspaceItemSelector(workspaceSlug)).first()
        await expect(workspace).toBeVisible()
        await workspace.hover()

        const newSession = page.locator(workspaceNewSessionSelector(workspaceSlug)).first()
        await expect(newSession).toBeVisible()
        await newSession.click({ force: true })

        await expect(page).toHaveURL(new RegExp(`/${workspaceSlug}/session(?:[/?#]|$)`))

        // Create a session by sending a prompt
        const prompt = page.locator(promptSelector)
        await expect(prompt).toBeVisible()
        await prompt.fill("test")
        await page.keyboard.press("Enter")

        // Wait for the URL to update with the new session ID
        await expect.poll(() => sessionIDFromUrl(page.url()) ?? "", { timeout: 15_000 }).not.toBe("")

        const created = sessionIDFromUrl(page.url())
        if (!created) throw new Error(`Failed to get session ID from url: ${page.url()}`)
        sessionID = created

        await expect(page).toHaveURL(new RegExp(`/${workspaceSlug}/session/${created}(?:[/?#]|$)`))

        await openSidebar(page)

        const otherButton = page.locator(projectSwitchSelector(otherSlug)).first()
        await expect(otherButton).toBeVisible()
        await otherButton.click()
        await expect(page).toHaveURL(new RegExp(`/${otherSlug}/session`))

        const rootButton = page.locator(projectSwitchSelector(slug)).first()
        await expect(rootButton).toBeVisible()
        await rootButton.click()

        await expect.poll(() => sessionIDFromUrl(page.url()) ?? "").toBe(created)
        await expect(page).toHaveURL(new RegExp(`/session/${created}(?:[/?#]|$)`))
      },
      { extra: [other] },
    )
  } finally {
    if (sessionID) {
      const id = sessionID
      const dirs = [rootDir, workspaceDir].filter((x): x is string => !!x)
      await Promise.all(
        dirs.map((directory) =>
          createSdk(directory)
            .session.delete({ sessionID: id })
            .catch(() => undefined),
        ),
      )
    }
    if (workspaceDir) {
      await cleanupTestProject(workspaceDir)
    }
    await cleanupTestProject(other)
  }
})
