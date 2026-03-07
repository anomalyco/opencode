import { base64Decode } from "@opencode-ai/util/encode"
import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import { cleanupTestProject, openSidebar, sessionIDFromUrl, setWorkspacesEnabled } from "../actions"
import { promptSelector, workspaceItemSelector, workspaceNewSessionSelector } from "../selectors"
import { createSdk } from "../utils"

function slugFromUrl(url: string) {
  return /\/([^/]+)\/session(?:\/|$)/.exec(url)?.[1] ?? ""
}

async function waitSlug(page: Page, skip: string[] = []) {
  let prev = ""
  await expect
    .poll(
      () => {
        const slug = slugFromUrl(page.url())
        if (!slug) return ""
        if (skip.includes(slug)) return ""
        if (slug !== prev) {
          prev = slug
          return ""
        }
        return slug
      },
      { timeout: 45_000 },
    )
    .not.toBe("")
  return slugFromUrl(page.url())
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

  const slug = await waitSlug(page, [root, ...seen])
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

  const next = await waitSlug(page)
  await expect(page).toHaveURL(new RegExp(`/${next}/session(?:[/?#]|$)`))
  return next
}

async function createSessionFromWorkspace(page: Page, slug: string, text: string) {
  const next = await openWorkspaceNewSession(page, slug)

  const prompt = page.locator(promptSelector)
  await expect(prompt).toBeVisible()
  await expect(prompt).toBeEditable()
  await prompt.click()
  await expect(prompt).toBeFocused()
  await prompt.fill(text)
  await expect.poll(async () => ((await prompt.textContent()) ?? "").trim()).toContain(text)
  await prompt.press("Enter")

  await expect.poll(() => slugFromUrl(page.url())).toBe(next)
  await expect.poll(() => sessionIDFromUrl(page.url()) ?? "", { timeout: 30_000 }).not.toBe("")

  const sessionID = sessionIDFromUrl(page.url())
  if (!sessionID) throw new Error(`Failed to parse session id from url: ${page.url()}`)
  await expect(page).toHaveURL(new RegExp(`/${next}/session/${sessionID}(?:[/?#]|$)`))
  return { sessionID, slug: next }
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
      sessions.push(firstSession.sessionID)

      const secondSession = await createSessionFromWorkspace(page, second.slug, `workspace two ${Date.now()}`)
      sessions.push(secondSession.sessionID)

      const thirdSession = await createSessionFromWorkspace(page, first.slug, `workspace one again ${Date.now()}`)
      sessions.push(thirdSession.sessionID)

      await expect.poll(() => sessionDirectory(first.directory, firstSession.sessionID)).toBe(first.directory)
      await expect.poll(() => sessionDirectory(second.directory, secondSession.sessionID)).toBe(second.directory)
      await expect.poll(() => sessionDirectory(first.directory, thirdSession.sessionID)).toBe(first.directory)
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
