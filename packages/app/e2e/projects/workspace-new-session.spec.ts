import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import {
  openSidebar,
  resolveSlug,
  sessionIDFromUrl,
  setWorkspacesEnabled,
  waitDir,
  waitSession,
  waitSlug,
} from "../actions"
import { workspaceItemSelector, workspaceNewSessionSelector } from "../selectors"

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
  project: Parameters<typeof test>[0]["project"],
  page: Page,
  space: { slug: string; raw: string; directory: string },
  text: string,
) {
  await openWorkspaceNewSession(page, space)
  return project.user(text)
}

test("new sessions from sidebar workspace actions stay in selected workspace", async ({ page, project }) => {
  await page.setViewportSize({ width: 1400, height: 800 })

  await project.open()
  await openSidebar(page)
  await setWorkspacesEnabled(page, project.slug, true)

  const first = await createWorkspace(page, project.slug, [])
  project.trackDirectory(first.directory)
  await waitWorkspaceReady(page, first)

  const second = await createWorkspace(page, project.slug, [first.slug])
  project.trackDirectory(second.directory)
  await waitWorkspaceReady(page, second)

  await createSessionFromWorkspace(project, page, first, `workspace one ${Date.now()}`)
  await createSessionFromWorkspace(project, page, second, `workspace two ${Date.now()}`)
  await createSessionFromWorkspace(project, page, first, `workspace one again ${Date.now()}`)
})
