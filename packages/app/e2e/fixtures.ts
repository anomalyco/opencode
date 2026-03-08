import { test as base, expect, type Page } from "@playwright/test"
import { cleanupSession, cleanupTestProject, createTestProject, seedProjects, sessionIDFromUrl } from "./actions"
import { promptSelector } from "./selectors"
import { createSdk, dirSlug, getWorktree, sessionPath } from "./utils"

export const settingsKey = "settings.v3"

type TestFixtures = {
  sdk: ReturnType<typeof createSdk>
  gotoSession: (sessionID?: string) => Promise<void>
  withProject: <T>(
    callback: (project: {
      directory: string
      slug: string
      gotoSession: (sessionID?: string) => Promise<void>
      trackSession: (sessionID: string, directory?: string) => void
      trackDirectory: (directory: string) => void
    }) => Promise<T>,
    options?: { extra?: string[] },
  ) => Promise<T>
}

type WorkerFixtures = {
  directory: string
  slug: string
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  directory: [
    async ({}, use) => {
      const directory = await getWorktree()
      await use(directory)
    },
    { scope: "worker" },
  ],
  slug: [
    async ({ directory }, use) => {
      await use(dirSlug(directory))
    },
    { scope: "worker" },
  ],
  sdk: async ({ directory }, use) => {
    await use(createSdk(directory))
  },
  gotoSession: async ({ page, directory }, use) => {
    await seedStorage(page, { directory })

    const gotoSession = async (sessionID?: string) => {
      await page.goto(sessionPath(directory, sessionID))
      await expect(page.locator(promptSelector)).toBeVisible()
    }
    await use(gotoSession)
  },
  withProject: async ({ page }, use) => {
    await use(async (callback, options) => {
      const root = await createTestProject()
      const slug = dirSlug(root)
      const sessions = new Map<string, string>()
      const dirs = new Set<string>()
      await seedStorage(page, { directory: root, extra: options?.extra })

      const gotoSession = async (sessionID?: string) => {
        await page.goto(sessionPath(root, sessionID))
        await expect(page.locator(promptSelector)).toBeVisible()
        const current = sessionIDFromUrl(page.url())
        if (current) trackSession(current)
      }

      const trackSession = (sessionID: string, directory?: string) => {
        sessions.set(sessionID, directory ?? root)
      }

      const trackDirectory = (directory: string) => {
        if (directory !== root) dirs.add(directory)
      }

      try {
        await gotoSession()
        return await callback({ directory: root, slug, gotoSession, trackSession, trackDirectory })
      } finally {
        await Promise.allSettled(
          Array.from(sessions, ([sessionID, directory]) => cleanupSession({ sessionID, directory })),
        )
        await Promise.allSettled(Array.from(dirs, (directory) => cleanupTestProject(directory)))
        await cleanupTestProject(root)
      }
    })
  },
})

async function seedStorage(page: Page, input: { directory: string; extra?: string[] }) {
  await seedProjects(page, input)
  await page.addInitScript(() => {
    localStorage.setItem(
      "opencode.global.dat:model",
      JSON.stringify({
        recent: [{ providerID: "opencode", modelID: "big-pickle" }],
        user: [],
        variant: {},
      }),
    )
  })
}

export { expect }
