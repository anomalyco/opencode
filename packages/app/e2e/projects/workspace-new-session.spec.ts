import { base64Decode } from "@opencode-ai/util/encode"
import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import { openSidebar, sessionIDFromUrl, setWorkspacesEnabled, slugFromUrl, waitSlug } from "../actions"
import { promptSelector, workspaceItemSelector, workspaceNewSessionSelector } from "../selectors"
import { createSdk } from "../utils"

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

  await withProject(async ({ directory, slug: root, trackSession, trackDirectory }) => {
    await openSidebar(page)
    await setWorkspacesEnabled(page, root, true)

    const first = await createWorkspace(page, root, [])
    trackDirectory(first.directory)
    await waitWorkspaceReady(page, first.slug)

    const second = await createWorkspace(page, root, [first.slug])
    trackDirectory(second.directory)
    await waitWorkspaceReady(page, second.slug)

    const firstSession = await createSessionFromWorkspace(page, first.slug, `workspace one ${Date.now()}`)
    trackSession(firstSession.sessionID, first.directory)

    const secondSession = await createSessionFromWorkspace(page, second.slug, `workspace two ${Date.now()}`)
    trackSession(secondSession.sessionID, second.directory)

    const thirdSession = await createSessionFromWorkspace(page, first.slug, `workspace one again ${Date.now()}`)
    trackSession(thirdSession.sessionID, first.directory)

    await expect.poll(() => sessionDirectory(first.directory, firstSession.sessionID)).toBe(first.directory)
    await expect.poll(() => sessionDirectory(second.directory, secondSession.sessionID)).toBe(second.directory)
    await expect.poll(() => sessionDirectory(first.directory, thirdSession.sessionID)).toBe(first.directory)
  })
})
