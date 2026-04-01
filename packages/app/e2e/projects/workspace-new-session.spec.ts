import { base64Decode } from "@opencode-ai/util/encode"
import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import { cleanupTestProject, openSidebar, sessionIDFromUrl, setWorkspacesEnabled } from "../actions"
import { promptSelector, workspaceItemSelector, workspaceNewSessionSelector } from "../selectors"
import { createSdk } from "../utils"

function slugFromUrl(url: string) {
  return /\/([^/]+)\/session(?:\/|$)/.exec(url)?.[1] ?? ""
}

async function waitWorkspaceReady(page: Page, slug: string) {
  await openSidebar(page)
  await expect
    .poll(
      async () => {
        const item = page.locator(workspaceItemSelector(slug)).first()
        try {
          await item.hover({ timeout: 500 })
          return true
        } catch {
          return false
        }
      },
      { timeout: 60_000 },
    )
    .toBe(true)
}

async function createWorkspace(page: Page, root: string, seen: string[]) {
  await openSidebar(page)
  await page.getByRole("button", { name: "New workspace" }).first().click()

  await expect
    .poll(
      () => {
        const slug = slugFromUrl(page.url())
        if (!slug) return ""
        if (slug === root) return ""
        if (seen.includes(slug)) return ""
        return slug
      },
      { timeout: 45_000 },
    )
    .not.toBe("")

  const slug = slugFromUrl(page.url())
  const directory = base64Decode(slug)
  if (!directory) throw new Error(`Failed to decode workspace slug: ${slug}`)
  return { slug, directory }
}

async function openWorkspaceNewSession(page: Page, slug: string) {
  await waitWorkspaceReady(page, slug)

  const item = page.locator(workspaceItemSelector(slug)).first()
  await item.hover()

  const button = page.locator(workspaceNewSessionSelector(slug)).first()
  await expect(button).toBeVisible()
  await button.click({ force: true })

  await expect.poll(() => slugFromUrl(page.url())).toBe(slug)
  await expect(page).toHaveURL(new RegExp(`/${slug}/session(?:[/?#]|$)`))
}

async function createSessionFromWorkspace(page: Page, slug: string, text: string) {
  await openWorkspaceNewSession(page, slug)

  const prompt = page.locator(promptSelector)
  await expect(prompt).toBeVisible()
  await expect(prompt).toBeEditable()
  await prompt.click()
  await expect(prompt).toBeFocused()
  await prompt.fill(text)
  await expect.poll(async () => ((await prompt.textContent()) ?? "").trim()).toContain(text)
  await prompt.press("Enter")

  await expect.poll(() => slugFromUrl(page.url())).toBe(slug)
  await expect.poll(() => sessionIDFromUrl(page.url()) ?? "", { timeout: 30_000 }).not.toBe("")

  const sessionID = sessionIDFromUrl(page.url())
  if (!sessionID) throw new Error(`Failed to parse session id from url: ${page.url()}`)
  await expect(page).toHaveURL(new RegExp(`/${slug}/session/${sessionID}(?:[/?#]|$)`))
  return sessionID
}

async function sessionDirectory(directory: string, sessionID: string) {
  const info = await createSdk(directory)
    .session.get({ sessionID })
    .then((x) => x.data)
    .catch(() => undefined)
  if (!info) return ""
  return info.directory
}

test("new sessions from sidebar workspace actions stay in selected workspace", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  await withProject(async ({ directory, slug: root }) => {
    const workspaces = [] as { slug: string; directory: string }[]
    const sessions = [] as string[]

    try {
      await openSidebar(page)
      await setWorkspacesEnabled(page, root, true)

      const first = await createWorkspace(page, root, [])
      workspaces.push(first)
      await waitWorkspaceReady(page, first.slug)

      const second = await createWorkspace(page, root, [first.slug])
      workspaces.push(second)
      await waitWorkspaceReady(page, second.slug)

      const firstSession = await createSessionFromWorkspace(page, first.slug, `workspace one ${Date.now()}`)
      sessions.push(firstSession)

      const secondSession = await createSessionFromWorkspace(page, second.slug, `workspace two ${Date.now()}`)
      sessions.push(secondSession)

      const thirdSession = await createSessionFromWorkspace(page, first.slug, `workspace one again ${Date.now()}`)
      sessions.push(thirdSession)

      await expect.poll(() => sessionDirectory(first.directory, firstSession)).toBe(first.directory)
      await expect.poll(() => sessionDirectory(second.directory, secondSession)).toBe(second.directory)
      await expect.poll(() => sessionDirectory(first.directory, thirdSession)).toBe(first.directory)
    } finally {
      const dirs = [directory, ...workspaces.map((workspace) => workspace.directory)]
      await Promise.all(
        sessions.map((sessionID) =>
          Promise.all(
            dirs.map((dir) =>
              createSdk(dir)
                .session.delete({ sessionID })
                .catch(() => undefined),
            ),
          ),
        ),
      )
      await Promise.all(workspaces.map((workspace) => cleanupTestProject(workspace.directory)))
    }
  })
})
