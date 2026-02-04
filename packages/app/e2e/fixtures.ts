import { test as base, expect, type Page } from "@playwright/test"
import { cleanupTestProject, createTestProject, seedProjects } from "./actions"
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
      const directory = await createTestProject()
      const slug = dirSlug(directory)
      await seedStorage(page, { directory, extra: options?.extra })

      const gotoSession = async (sessionID?: string) => {
        await page.goto(sessionPath(directory, sessionID))
        await expect(page.locator(promptSelector)).toBeVisible()
      }

      try {
        await gotoSession()
        return await callback({ directory, slug, gotoSession })
      } finally {
        await cleanupTestProject(directory)
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
