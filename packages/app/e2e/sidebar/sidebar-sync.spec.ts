import type { Browser, Page } from "@playwright/test"
import { test, expect } from "../fixtures"
import { cleanupTestProject, clickMenuItem, createTestProject, enableE2E, openProjectMenu, openSidebar, seedProjects, waitSession } from "../actions"
import { projectSwitchSelector, sidebarNavSelector } from "../selectors"
import { createSdk, dirSlug, sessionPath } from "../utils"

async function openFresh(browser: Browser, directory: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await enableE2E(page)
  await page.setViewportSize({ width: 1400, height: 800 })
  await page.goto(sessionPath(directory))
  await waitSession(page, { directory })
  await openSidebar(page)
  return { context, page }
}

async function listProjects(page: Page) {
  return page.locator(`${sidebarNavSelector} [data-action="project-switch"]`).evaluateAll((els) => {
    return els.map((el) => el.getAttribute("data-project") ?? "").filter((x) => x.length > 0)
  })
}

async function clearRail(sdk: ReturnType<typeof createSdk>) {
  const items = await sdk.project.sidebar.list().then((x) => x.data ?? [])
  if (items.length === 0) return
  await sdk.project.sidebar.reorder({ worktrees: [] })
}

test.describe("sidebar sync", () => {
  test("project opened syncs to a fresh client UI", async ({ browser }) => {
    let directory = ""
    try {
      directory = await createTestProject()
      const sdk = createSdk(directory)
      const slug = dirSlug(directory)
      await clearRail(sdk)

      await sdk.project.sidebar.open({ worktree: directory })

      const fresh = await openFresh(browser, directory)
      try {
        await expect(fresh.page.locator(projectSwitchSelector(slug)).first()).toBeVisible()
      } finally {
        await fresh.context.close()
      }
    } finally {
      if (directory) await cleanupTestProject(directory)
    }
  })

  test("project closed syncs to a fresh client UI", async ({ browser }) => {
    let directory = ""
    let other = ""
    try {
      directory = await createTestProject()
      other = await createTestProject()
      const sdk = createSdk(directory)
      const slug = dirSlug(directory)
      const otherSlug = dirSlug(other)
      await clearRail(sdk)
      await sdk.project.sidebar.reorder({ worktrees: [directory, other] })

      const pageA = await openFresh(browser, directory)
      try {
        const menu = await openProjectMenu(pageA.page, slug)
        await clickMenuItem(menu, /^Close$/i, { force: true })

        const pageB = await openFresh(browser, other)
        try {
          await expect(pageB.page.locator(projectSwitchSelector(otherSlug)).first()).toBeVisible()
          await expect.poll(() => pageB.page.locator(projectSwitchSelector(slug)).count()).toBe(0)
        } finally {
          await pageB.context.close()
        }
      } finally {
        await pageA.context.close()
      }
    } finally {
      if (directory) await cleanupTestProject(directory)
      if (other) await cleanupTestProject(other)
    }
  })

  test("reorder syncs to a fresh client UI", async ({ browser }) => {
    let directory = ""
    let dir2 = ""
    let dir3 = ""
    try {
      directory = await createTestProject()
      dir2 = await createTestProject()
      dir3 = await createTestProject()
      const sdk = createSdk(directory)
      const worktrees = [dir3, directory, dir2]
      await clearRail(sdk)

      await sdk.project.sidebar.reorder({ worktrees })

      const fresh = await openFresh(browser, directory)
      try {
        await expect.poll(() => listProjects(fresh.page)).toEqual(worktrees.map(dirSlug))
      } finally {
        await fresh.context.close()
      }
    } finally {
      if (directory) await cleanupTestProject(directory)
      if (dir2) await cleanupTestProject(dir2)
      if (dir3) await cleanupTestProject(dir3)
    }
  })

  test("migration seeds empty server rail from legacy local rail", async ({ browser, page }) => {
    await page.setViewportSize({ width: 1400, height: 800 })

    let directory = ""
    try {
      directory = await createTestProject()
      const sdk = createSdk(directory)
      const slug = dirSlug(directory)
      await clearRail(sdk)
      const before = await sdk.project.sidebar.list()
      expect(before.data!).toHaveLength(0)

      await seedProjects(page, { directory })
      await enableE2E(page)
      await page.goto(sessionPath(directory))
      await waitSession(page, { directory })
      await openSidebar(page)
      await expect(page.locator(projectSwitchSelector(slug)).first()).toBeVisible()

      const fresh = await openFresh(browser, directory)
      try {
        await expect(fresh.page.locator(projectSwitchSelector(slug)).first()).toBeVisible()
      } finally {
        await fresh.context.close()
      }
    } finally {
      if (directory) await cleanupTestProject(directory)
    }
  })

  test("existing server rail is not overwritten by legacy local state", async ({ browser, page }) => {
    await page.setViewportSize({ width: 1400, height: 800 })

    let directory = ""
    let other = ""
    try {
      directory = await createTestProject()
      other = await createTestProject()
      const slug = dirSlug(directory)
      const otherSlug = dirSlug(other)
      const sdk = createSdk(directory)
      await clearRail(sdk)

      await sdk.project.sidebar.reorder({ worktrees: [other] })

      await seedProjects(page, { directory })
      await enableE2E(page)
      await page.goto(sessionPath(directory))
      await waitSession(page, { directory })
      await openSidebar(page)
      await expect(page.locator(projectSwitchSelector(otherSlug)).first()).toBeVisible()
      await expect.poll(() => page.locator(projectSwitchSelector(slug)).count()).toBe(0)

      const fresh = await openFresh(browser, other)
      try {
        await expect(fresh.page.locator(projectSwitchSelector(otherSlug)).first()).toBeVisible()
        await expect.poll(() => fresh.page.locator(projectSwitchSelector(slug)).count()).toBe(0)
      } finally {
        await fresh.context.close()
      }
    } finally {
      if (directory) await cleanupTestProject(directory)
      if (other) await cleanupTestProject(other)
    }
  })

  test("path variants do not duplicate sidebar items", async ({ browser }) => {
    let directory = ""
    try {
      directory = await createTestProject()
      const sdk = createSdk(directory)
      const slug = dirSlug(directory)
      await clearRail(sdk)

      await sdk.project.sidebar.reorder({ worktrees: [directory, `${directory}/`] })

      const fresh = await openFresh(browser, directory)
      try {
        await expect(fresh.page.locator(projectSwitchSelector(slug))).toHaveCount(1)
      } finally {
        await fresh.context.close()
      }
    } finally {
      if (directory) await cleanupTestProject(directory)
    }
  })
})
