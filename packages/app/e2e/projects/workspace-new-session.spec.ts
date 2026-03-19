import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import { openSidebar, sessionIDFromUrl, setWorkspacesEnabled, slugFromUrl, waitSlug } from "../actions"
import { promptSelector, workspaceItemSelector, workspaceNewSessionSelector } from "../selectors"
import { createSdk, dirDecode, dirSlug, resolveDirectory } from "../utils"

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

  const raw = await waitSlug(page, [root, ...seen])
  const directory = dirDecode(raw)
  if (!directory) throw new Error(`Failed to decode workspace slug: ${raw}`)
  const space = await resolveDirectory(directory)
  return { slug: dirSlug(space), directory: space, raw }
}

async function openWorkspaceNewSession(page: Page, slug: string, raw = slug) {
  await waitWorkspaceReady(page, slug)

  const item = page.locator(`${workspaceItemSelector(slug)}, ${workspaceItemSelector(raw)}`).first()
  await item.hover()

  const button = page.locator(`${workspaceNewSessionSelector(slug)}, ${workspaceNewSessionSelector(raw)}`).first()
  await expect(button).toBeVisible()
  await button.click({ force: true })

  const next = await waitSlug(page)
  await expect(page).toHaveURL(new RegExp(`/${next}/session(?:[/?#]|$)`))
  return next
}

async function createSessionFromWorkspace(
  page: Page,
  workspace: { slug: string; raw?: string },
  text: string,
) {
  const next = await openWorkspaceNewSession(page, workspace.slug, workspace.raw)
  const directory = dirDecode(next)
  if (!directory) throw new Error(`Failed to decode workspace slug: ${next}`)
  const space = await resolveDirectory(directory)
  const target = dirSlug(space)

  const prompt = page.locator(promptSelector)
  await expect(prompt).toBeVisible()
  await expect(prompt).toBeEditable()
  await prompt.click()
  await expect(prompt).toBeFocused()
  await prompt.fill(text)
  await expect.poll(async () => ((await prompt.textContent()) ?? "").trim()).toContain(text)
  await prompt.press("Enter")

  await expect.poll(() => slugFromUrl(page.url())).toBe(target)
  await expect.poll(() => sessionIDFromUrl(page.url()) ?? "", { timeout: 30_000 }).not.toBe("")

  const sessionID = sessionIDFromUrl(page.url())
  if (!sessionID) throw new Error(`Failed to parse session id from url: ${page.url()}`)
  await expect(page).toHaveURL(new RegExp(`/${target}/session/${sessionID}(?:[/?#]|$)`))
  return { sessionID, slug: target }
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

    const firstSession = await createSessionFromWorkspace(page, first, `workspace one ${Date.now()}`)
    trackSession(firstSession.sessionID, first.directory)

    const secondSession = await createSessionFromWorkspace(page, second, `workspace two ${Date.now()}`)
    trackSession(secondSession.sessionID, second.directory)

    const thirdSession = await createSessionFromWorkspace(page, first, `workspace one again ${Date.now()}`)
    trackSession(thirdSession.sessionID, first.directory)

    await expect.poll(() => sessionDirectory(first.directory, firstSession.sessionID)).toBe(first.directory)
    await expect.poll(() => sessionDirectory(second.directory, secondSession.sessionID)).toBe(second.directory)
    await expect.poll(() => sessionDirectory(first.directory, thirdSession.sessionID)).toBe(first.directory)
  })
})
