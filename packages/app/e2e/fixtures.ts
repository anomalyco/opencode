import { test as base, expect, type Page } from "@playwright/test"
import type { E2EWindow } from "../src/testing/terminal"
import {
  healthPhase,
  cleanupSession,
  cleanupTestProject,
  createTestProject,
  setHealthPhase,
  seedProjects,
  sessionIDFromUrl,
  waitSlug,
  waitSession,
} from "./actions"
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
  page: async ({ page }, use) => {
    let boundary: string | undefined
    setHealthPhase(page, "test")
    const consoleHandler = (msg: { text(): string }) => {
      const text = msg.text()
      if (!text.includes("[e2e:error-boundary]")) return
      if (healthPhase(page) === "cleanup") {
        console.warn(`[e2e:error-boundary][cleanup-warning]\n${text}`)
        return
      }
      boundary ||= text
      console.log(text)
    }
    const pageErrorHandler = (err: Error) => {
      console.log(`[e2e:pageerror] ${err.stack || err.message}`)
    }
    page.on("console", consoleHandler)
    page.on("pageerror", pageErrorHandler)
    await use(page)
    page.off("console", consoleHandler)
    page.off("pageerror", pageErrorHandler)
    if (boundary) throw new Error(boundary)
  },
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
      await waitSession(page, { directory, sessionID })
    }
    await use(gotoSession)
  },
  withProject: async ({ page }, use) => {
    await use(async (callback, options) => {
      const root = await createTestProject()
      const sessions = new Map<string, string>()
      const dirs = new Set<string>()
      await seedStorage(page, { directory: root, extra: options?.extra })

      const gotoSession = async (sessionID?: string) => {
        await page.goto(sessionPath(root, sessionID))
        await waitSession(page, { directory: root, sessionID })
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
        const slug = await waitSlug(page)
        return await callback({ directory: root, slug, gotoSession, trackSession, trackDirectory })
      } finally {
        setHealthPhase(page, "cleanup")
        await Promise.allSettled(
          Array.from(sessions, ([sessionID, directory]) => cleanupSession({ sessionID, directory })),
        )
        await Promise.allSettled(Array.from(dirs, (directory) => cleanupTestProject(directory)))
        await cleanupTestProject(root)
        setHealthPhase(page, "test")
      }
    })
  },
})

async function seedStorage(page: Page, input: { directory: string; extra?: string[] }) {
  await seedProjects(page, input)
  await page.addInitScript(() => {
    const win = window as E2EWindow
    win.__opencode_e2e = {
      ...win.__opencode_e2e,
      model: {
        enabled: true,
      },
      prompt: {
        enabled: true,
      },
      terminal: {
        enabled: true,
        terminals: {},
      },
    }
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
