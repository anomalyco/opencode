import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import {
  openSidebar,
  resolveSlug,
  sessionIDFromUrl,
  setWorkspacesEnabled,
  waitDir,
  waitSession,
  waitSessionSaved,
  waitSlug,
} from "../actions"
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
  await expect(page.locator(item(space)).first()).toBeVisible({ timeout: 60_000 })
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

  await waitSession(page, { directory: space.directory })
  await expect.poll(() => sessionIDFromUrl(page.url()) ?? "").toBe("")
}

async function createSessionFromWorkspace(
  page: Page,
  space: { slug: string; raw: string; directory: string },
  text: string,
) {
  await openWorkspaceNewSession(page, space)

  const prompt = page.locator(promptSelector)
  await expect(prompt).toBeVisible()
  await prompt.fill(text)
  await page.keyboard.press("Enter")

  await expect.poll(() => sessionIDFromUrl(page.url()) ?? "", { timeout: 15_000 }).not.toBe("")
  const sessionID = sessionIDFromUrl(page.url())
  if (!sessionID) throw new Error(`Failed to parse session id from url: ${page.url()}`)

  await waitSessionSaved(space.directory, sessionID)
  await createSdk(space.directory)
    .session.abort({ sessionID })
    .catch(() => undefined)
  return sessionID
}

test("new sessions from sidebar workspace actions stay in selected workspace", async ({ page, withProject }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  await withProject(async ({ slug: root, trackDirectory, trackSession }) => {
    await openSidebar(page)
    await setWorkspacesEnabled(page, root, true)

    const first = await createWorkspace(page, root, [])
    trackDirectory(first.directory)
    await waitWorkspaceReady(page, first)

    const second = await createWorkspace(page, root, [first.slug])
    trackDirectory(second.directory)
    await waitWorkspaceReady(page, second)

    trackSession(await createSessionFromWorkspace(page, first, `workspace one ${Date.now()}`), first.directory)
    trackSession(await createSessionFromWorkspace(page, second, `workspace two ${Date.now()}`), second.directory)
    trackSession(await createSessionFromWorkspace(page, first, `workspace one again ${Date.now()}`), first.directory)
  })
})
