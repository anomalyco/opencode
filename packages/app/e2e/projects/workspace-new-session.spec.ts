import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import { openSidebar, resolveSlug, sessionIDFromUrl, setWorkspacesEnabled, waitDir, waitSlug } from "../actions"
import { promptSelector, workspaceItemSelector, workspaceNewSessionSelector } from "../selectors"
import { createSdk } from "../utils"

function item(space: { slug: string; raw: string }) {
  return `${workspaceItemSelector(space.slug)}, ${workspaceItemSelector(space.raw)}`
}

function button(space: { slug: string; raw: string }) {
  return `${workspaceNewSessionSelector(space.slug)}, ${workspaceNewSessionSelector(space.raw)}`
}

async function waitWorkspaceReady(page: Page, space: { slug: string; raw: string }) {
  await openSidebar(page)
  await expect
    .poll(
      async () => {
        const row = page.locator(item(space)).first()
        try {
          await row.hover({ timeout: 500 })
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

  const next = await resolveSlug(await waitSlug(page, [root, ...seen]))
  await waitDir(page, next.directory)
  return next
}

async function openWorkspaceNewSession(page: Page, space: { slug: string; raw: string; directory: string }) {
  await waitWorkspaceReady(page, space)

  const row = page.locator(item(space)).first()
  await row.hover()

  const next = page.locator(button(space)).first()
  await expect(next).toBeVisible()
  await next.click({ force: true })

  return waitDir(page, space.directory)
}

async function createSessionFromWorkspace(
  page: Page,
  space: { slug: string; raw: string; directory: string },
  text: string,
) {
  const next = await openWorkspaceNewSession(page, space)

  const prompt = page.locator(promptSelector)
  await expect(prompt).toBeVisible()
  await expect(prompt).toBeEditable()
  await prompt.click()
  await expect(prompt).toBeFocused()
  await prompt.fill(text)
  await expect.poll(async () => ((await prompt.textContent()) ?? "").trim()).toContain(text)
  await prompt.press("Enter")

  await waitDir(page, next.directory)
  await expect.poll(() => sessionIDFromUrl(page.url()) ?? "", { timeout: 30_000 }).not.toBe("")

  const sessionID = sessionIDFromUrl(page.url())
  if (!sessionID) throw new Error(`Failed to parse session id from url: ${page.url()}`)
  await expect(page).toHaveURL(new RegExp(`/session/${sessionID}(?:[/?#]|$)`))
  return { sessionID, slug: next.slug }
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
    await waitWorkspaceReady(page, first)

    const second = await createWorkspace(page, root, [first.slug])
    trackDirectory(second.directory)
    await waitWorkspaceReady(page, second)

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
